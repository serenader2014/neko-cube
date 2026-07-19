import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { open, type Reader } from "maxmind";

export type GeoLocation = {
  countryCode: string;
  countryName: string;
  continentCode: string;
  continentName: string;
};

type GeoLookupRecord = {
  country?: { iso_code?: string; names?: Record<string, string> };
  continent?: { code?: string; names?: Record<string, string> };
};

type GeoIPApiResponse = {
  country?: unknown;
  country_name?: unknown;
  continent?: unknown;
  continent_name?: unknown;
  reserved?: unknown;
};

const UNKNOWN_GEO: GeoLocation = {
  countryCode: "Unknown",
  countryName: "Unknown",
  continentCode: "Unknown",
  continentName: "Unknown",
};

const LOCAL_GEO: GeoLocation = {
  countryCode: "LOCAL",
  countryName: "Local Network",
  continentCode: "LOCAL",
  continentName: "Local Network",
};

const DEFAULT_MMDB_FILES = ["GeoLite2-City.mmdb", "GeoLite2-Country.mmdb"];
const DEFAULT_MMDB_DIRS = ["geoip", "geo", path.join("..", "geoip"), path.join("..", "geo"), "/app/data/geoip"];
const DEFAULT_ONLINE_API_URL = "https://api.ipinfo.es/ipinfo";
const ONLINE_LOOKUP_TIMEOUT_MS = 8000;
const FAILED_LOOKUP_COOLDOWN_MS = 30 * 60 * 1000;
const MEMORY_CACHE_MAX_ENTRIES = 50_000;
const countryDisplayNames =
  typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["zh-CN"], { type: "region" }) : null;

const REGION_FALLBACKS: GeoLocationCandidate[] = [
  {
    countryCode: "HK",
    countryName: "香港",
    continentCode: "AS",
    continentName: "Asia",
    keywords: ["香港", "hong kong", "hongkong", "hk", "港", "🇭🇰"],
  },
  {
    countryCode: "TW",
    countryName: "台湾",
    continentCode: "AS",
    continentName: "Asia",
    keywords: ["台湾", "taiwan", "taipei", "tw", "台", "🇹🇼"],
  },
  {
    countryCode: "SG",
    countryName: "新加坡",
    continentCode: "AS",
    continentName: "Asia",
    keywords: ["新加坡", "singapore", "sing", "sg", "狮城", "🇸🇬"],
  },
  {
    countryCode: "JP",
    countryName: "日本",
    continentCode: "AS",
    continentName: "Asia",
    keywords: ["日本", "japan", "tokyo", "osaka", "jp", "日", "🇯🇵"],
  },
  {
    countryCode: "US",
    countryName: "美国",
    continentCode: "NA",
    continentName: "North America",
    keywords: ["美国", "united states", "america", "usa", "us", "美", "🇺🇸"],
  },
  {
    countryCode: "CN",
    countryName: "中国",
    continentCode: "AS",
    continentName: "Asia",
    keywords: ["中国", "china", "cn", "大陆", "🇨🇳"],
  },
  {
    countryCode: "KR",
    countryName: "韩国",
    continentCode: "AS",
    continentName: "Asia",
    keywords: ["韩国", "korea", "seoul", "kr", "韩", "🇰🇷"],
  },
  {
    countryCode: "GB",
    countryName: "英国",
    continentCode: "EU",
    continentName: "Europe",
    keywords: ["英国", "united kingdom", "great britain", "london", "uk", "gb", "英", "🇬🇧"],
  },
  {
    countryCode: "DE",
    countryName: "德国",
    continentCode: "EU",
    continentName: "Europe",
    keywords: ["德国", "germany", "frankfurt", "de", "德", "🇩🇪"],
  },
  {
    countryCode: "FR",
    countryName: "法国",
    continentCode: "EU",
    continentName: "Europe",
    keywords: ["法国", "france", "paris", "fr", "法", "🇫🇷"],
  },
  {
    countryCode: "NL",
    countryName: "荷兰",
    continentCode: "EU",
    continentName: "Europe",
    keywords: ["荷兰", "netherlands", "holland", "amsterdam", "nl", "荷", "🇳🇱"],
  },
  {
    countryCode: "CA",
    countryName: "加拿大",
    continentCode: "NA",
    continentName: "North America",
    keywords: ["加拿大", "canada", "ca", "加", "🇨🇦"],
  },
  {
    countryCode: "AU",
    countryName: "澳大利亚",
    continentCode: "OC",
    continentName: "Oceania",
    keywords: ["澳大利亚", "australia", "sydney", "au", "澳", "🇦🇺"],
  },
];

type GeoLocationCandidate = GeoLocation & {
  keywords: string[];
};

const geoIpServiceInstances = new Set<GeoIpService>();

export class GeoIpService {
  private reader: Reader<any> | null = null;
  private ready: Promise<void> = Promise.resolve();
  private databasePath: string | null = null;
  private memoryCache = new Map<string, GeoLocation>();
  private pendingQueries = new Map<string, Promise<GeoLocation>>();
  private failedIps = new Map<string, number>();

  constructor(
    private mmdbPath: string | undefined,
    private cwd = process.cwd(),
  ) {
    geoIpServiceInstances.add(this);
    this.ready = this.loadDatabase();
  }

  private async loadDatabase() {
    const resolvedPath = resolveMmdbPath(this.mmdbPath, this.cwd);
    this.reader = null;
    this.databasePath = null;
    if (resolvedPath) {
      this.databasePath = resolvedPath;
      try {
        this.reader = await open(resolvedPath);
        this.memoryCache.clear();
        console.log(`[geoip] loaded ${resolvedPath}`);
      } catch (error) {
        console.warn(`[geoip] failed to open ${resolvedPath}:`, error);
      }
    }
  }

  lookup(ip: string, fallbackText = "") {
    const normalizedIp = normalizeIp(ip);
    if (normalizedIp && isPrivateIp(normalizedIp)) {
      return LOCAL_GEO;
    }

    const geo = normalizedIp ? this.lookupLocal(normalizedIp) : UNKNOWN_GEO;
    if (isKnownGeoLocation(geo)) {
      return geo;
    }
    return inferGeoFromText(fallbackText) ?? geo;
  }

  async lookupIp(ip: string) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
      return UNKNOWN_GEO;
    }
    if (isPrivateIp(normalizedIp)) {
      return LOCAL_GEO;
    }

    const cached = this.memoryCache.get(normalizedIp);
    if (cached) {
      return cached;
    }

    const localGeo = this.lookupLocal(normalizedIp);
    if (isKnownGeoLocation(localGeo)) {
      this.setMemoryCache(normalizedIp, localGeo);
      return localGeo;
    }

    if (!shouldUseOnlineLookup()) {
      return UNKNOWN_GEO;
    }

    const failedAt = this.failedIps.get(normalizedIp);
    if (failedAt && Date.now() - failedAt < FAILED_LOOKUP_COOLDOWN_MS) {
      return UNKNOWN_GEO;
    }

    const pending = this.pendingQueries.get(normalizedIp);
    if (pending) {
      return pending;
    }

    const promise = this.lookupOnline(normalizedIp);
    this.pendingQueries.set(normalizedIp, promise);
    try {
      return await promise;
    } finally {
      this.pendingQueries.delete(normalizedIp);
    }
  }

  lookupIpCached(ip: string) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
      return UNKNOWN_GEO;
    }
    if (isPrivateIp(normalizedIp)) {
      return LOCAL_GEO;
    }
    const cached = this.memoryCache.get(normalizedIp);
    if (cached) {
      return cached;
    }
    const localGeo = this.lookupLocal(normalizedIp);
    if (isKnownGeoLocation(localGeo)) {
      this.setMemoryCache(normalizedIp, localGeo);
      return localGeo;
    }
    return UNKNOWN_GEO;
  }

  primeIpLookup(ip: string) {
    if (!shouldUseOnlineLookup()) {
      return;
    }
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp || isPrivateIp(normalizedIp) || this.memoryCache.has(normalizedIp)) {
      return;
    }
    void this.lookupIp(normalizedIp).catch(() => undefined);
  }

  private lookupLocal(normalizedIp: string) {
    if (!this.reader) {
      return UNKNOWN_GEO;
    }

    try {
      const record = this.reader.get(normalizedIp) as GeoLookupRecord | null;
      return {
        countryCode: record?.country?.iso_code || UNKNOWN_GEO.countryCode,
        countryName: getCountryDisplayName(record?.country?.iso_code, pickLocalizedName(record?.country?.names) || UNKNOWN_GEO.countryName),
        continentCode: record?.continent?.code || UNKNOWN_GEO.continentCode,
        continentName: pickLocalizedName(record?.continent?.names) || record?.continent?.code || UNKNOWN_GEO.continentName,
      };
    } catch {
      return UNKNOWN_GEO;
    }
  }

  private async lookupOnline(normalizedIp: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ONLINE_LOOKUP_TIMEOUT_MS);
    try {
      const response = await fetch(buildLookupUrl(getOnlineApiUrl(), normalizedIp), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        this.failedIps.set(normalizedIp, Date.now());
        return UNKNOWN_GEO;
      }
      const data = (await response.json()) as GeoIPApiResponse;
      const geo =
        data.reserved === true
          ? {
              countryCode: "RESERVED",
              countryName: "Reserved IP",
              continentCode: "RESERVED",
              continentName: "Reserved",
            }
          : {
              countryCode: toStringValue(data.country, UNKNOWN_GEO.countryCode),
              countryName: getCountryDisplayName(
                toStringValue(data.country, UNKNOWN_GEO.countryCode),
                toStringValue(data.country_name, UNKNOWN_GEO.countryName),
              ),
              continentCode: toStringValue(data.continent, UNKNOWN_GEO.continentCode),
              continentName: toStringValue(data.continent_name, UNKNOWN_GEO.continentName),
            };

      if (isKnownGeoLocation(geo)) {
        this.setMemoryCache(normalizedIp, geo);
        this.failedIps.delete(normalizedIp);
      }
      return geo;
    } catch {
      this.failedIps.set(normalizedIp, Date.now());
      return UNKNOWN_GEO;
    } finally {
      clearTimeout(timeout);
    }
  }

  private setMemoryCache(ip: string, geo: GeoLocation) {
    this.memoryCache.set(ip, geo);
    if (this.memoryCache.size <= MEMORY_CACHE_MAX_ENTRIES) {
      return;
    }
    const overflow = this.memoryCache.size - MEMORY_CACHE_MAX_ENTRIES;
    for (let index = 0; index < overflow; index += 1) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.memoryCache.delete(oldestKey);
    }
  }

  hasDatabase() {
    return this.reader !== null;
  }

  getDatabasePath() {
    return this.databasePath;
  }

  async whenReady() {
    await this.ready;
  }

  async refreshDatabase() {
    this.ready = this.loadDatabase();
    await this.ready;
  }
}

export async function reloadGeoIpDatabases() {
  await Promise.all(Array.from(geoIpServiceInstances, (service) => service.refreshDatabase()));
}

function shouldUseOnlineLookup() {
  const provider = process.env.GEOIP_LOOKUP_PROVIDER?.trim().toLowerCase();
  return provider !== "local";
}

function getOnlineApiUrl() {
  return process.env.GEOIP_ONLINE_API_URL?.trim() || DEFAULT_ONLINE_API_URL;
}

function buildLookupUrl(baseUrl: string, ip: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("ip", ip);
  if (!url.searchParams.has("meituan")) {
    url.searchParams.set("meituan", "false");
  }
  return url.toString();
}

export function isKnownGeoLocation(geo: GeoLocation) {
  return Boolean(geo.countryCode && geo.countryCode !== UNKNOWN_GEO.countryCode);
}

export function getCountryDisplayName(countryCode: string | undefined, fallback: string) {
  const normalizedCode = countryCode?.trim().toUpperCase() ?? "";
  if (normalizedCode === "LOCAL" || normalizedCode === "RESERVED" || normalizedCode === "UNKNOWN") {
    return fallback;
  }
  if (/^[A-Z]{2}$/.test(normalizedCode)) {
    return countryDisplayNames?.of(normalizedCode) || fallback;
  }
  return fallback;
}

function toStringValue(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return fallback;
}

function resolveMmdbPath(explicitPath: string | undefined, cwd: string) {
  if (process.env.GEOIP_MMDB_DISABLED?.trim() === "1") {
    return null;
  }

  const explicit = explicitPath?.trim();
  if (explicit) {
    const resolved = path.resolve(cwd, explicit);
    if (isMmdbFile(resolved)) {
      return resolved;
    }
    const fromDir = findMmdbInDir(resolved);
    if (fromDir) {
      return fromDir;
    }
  }

  const envDir = process.env.GEOIP_MMDB_DIR?.trim();
  const candidates = [envDir, ...DEFAULT_MMDB_DIRS.map((dir) => path.resolve(cwd, dir))]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => path.resolve(cwd, dir));
  for (const dir of Array.from(new Set(candidates))) {
    const found = findMmdbInDir(dir);
    if (found) {
      return found;
    }
  }
  return null;
}

function findMmdbInDir(dir: string) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  for (const file of DEFAULT_MMDB_FILES) {
    const filePath = path.join(dir, file);
    if (isMmdbFile(filePath)) {
      return filePath;
    }
  }
  return null;
}

function isMmdbFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pickLocalizedName(names: Record<string, string> | undefined) {
  return names?.["zh-CN"] || names?.zh || names?.en || "";
}

function normalizeIp(value: string) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  if (net.isIP(raw)) {
    return raw;
  }
  const bracketedIpv6 = raw.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketedIpv6 && net.isIP(bracketedIpv6[1])) {
    return bracketedIpv6[1];
  }
  const hostPort = raw.match(/^([0-9.]+):\d+$/);
  if (hostPort && net.isIP(hostPort[1])) {
    return hostPort[1];
  }
  return "";
}

function isPrivateIp(ip: string) {
  if (ip === "127.0.0.1" || ip === "::1") {
    return true;
  }
  if (ip.includes(":")) {
    const normalized = ip.toLowerCase();
    return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function inferGeoFromText(text: string) {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) {
    return null;
  }
  const candidate = REGION_FALLBACKS.find((item) =>
    item.keywords.some((keyword) => matchesRegionKeyword(normalized, keyword)),
  );
  return candidate
    ? {
        countryCode: candidate.countryCode,
        countryName: candidate.countryName,
        continentCode: candidate.continentCode,
        continentName: candidate.continentName,
      }
    : null;
}

function matchesRegionKeyword(text: string, keyword: string) {
  const normalizedKeyword = keyword.toLowerCase();
  if (/^[a-z0-9]{2,4}$/.test(normalizedKeyword)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedKeyword)}($|[^a-z0-9])`).test(text);
  }
  return text.includes(normalizedKeyword);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
