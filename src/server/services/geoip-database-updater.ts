import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import cron, { type ScheduledTask } from "node-cron";
import { open } from "maxmind";
import { reloadGeoIpDatabases } from "./geoip-service.js";

const gunzipAsync = promisify(gunzip);

const DEFAULT_GEOIP_DATABASE_URL = "https://cdn.jsdelivr.net/npm/geolite2-country/GeoLite2-Country.mmdb.gz";
const DEFAULT_GEOIP_DATABASE_FILE = "GeoLite2-Country.mmdb";
const DEFAULT_GEOIP_DATABASE_DIR = "geoip";
const DEFAULT_REFRESH_CRON = "23 4 * * 1";
const DEFAULT_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

type EnsureOptions = {
  force?: boolean;
};

export function getManagedGeoIpDatabasePath(cwd = process.cwd()) {
  const explicitPath = process.env.GEOIP_MMDB_PATH?.trim();
  if (explicitPath) {
    return path.resolve(cwd, explicitPath);
  }

  const explicitDir = process.env.GEOIP_MMDB_DIR?.trim();
  return path.join(path.resolve(cwd, explicitDir || DEFAULT_GEOIP_DATABASE_DIR), DEFAULT_GEOIP_DATABASE_FILE);
}

export function createGeoIpDatabaseUpdater(cwd = process.cwd()) {
  let task: ScheduledTask | null = null;
  let pendingUpdate: Promise<boolean> | null = null;

  async function ensureFresh(options: EnsureOptions = {}) {
    if (!shouldAutoUpdateGeoIpDatabase()) {
      return false;
    }

    if (pendingUpdate) {
      return pendingUpdate;
    }

    pendingUpdate = runEnsureFresh(options)
      .catch((error) => {
        console.warn("[geoip] database update failed:", error);
        return false;
      })
      .finally(() => {
        pendingUpdate = null;
      });

    return pendingUpdate;
  }

  async function runEnsureFresh(options: EnsureOptions) {
    const targetPath = getManagedGeoIpDatabasePath(cwd);
    if (!options.force && (await isFreshDatabase(targetPath))) {
      return false;
    }

    await downloadDatabase(targetPath);
    await reloadGeoIpDatabases();
    return true;
  }

  async function start() {
    await ensureFresh();
    if (!shouldAutoUpdateGeoIpDatabase() || task) {
      return;
    }

    task = cron.schedule(getRefreshCronExpression(), async () => {
      await ensureFresh({ force: true });
    });
  }

  function stop() {
    if (!task) {
      return;
    }
    task.stop();
    task.destroy();
    task = null;
  }

  return {
    ensureFresh,
    start,
    stop,
  };
}

async function isFreshDatabase(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && Date.now() - stat.mtimeMs < DEFAULT_REFRESH_INTERVAL_MS;
  } catch {
    return false;
  }
}

async function downloadDatabase(targetPath: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    const response = await fetch(getDownloadUrl(), {
      signal: controller.signal,
      headers: { Accept: "application/gzip, application/octet-stream" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const compressed = Buffer.from(await response.arrayBuffer());
    const database = await gunzipAsync(compressed);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(tempPath, database);
    await validateDatabase(tempPath);
    await fs.rename(tempPath, targetPath);
    console.log(`[geoip] downloaded ${targetPath}`);
  } finally {
    clearTimeout(timeout);
    if (fsSync.existsSync(tempPath)) {
      await fs.rm(tempPath, { force: true });
    }
  }
}

async function validateDatabase(filePath: string) {
  await open(filePath);
}

function shouldAutoUpdateGeoIpDatabase() {
  return process.env.GEOIP_MMDB_AUTO_UPDATE?.trim() !== "0";
}

function getDownloadUrl() {
  return process.env.GEOIP_MMDB_DOWNLOAD_URL?.trim() || DEFAULT_GEOIP_DATABASE_URL;
}

function getRefreshCronExpression() {
  return process.env.GEOIP_MMDB_REFRESH_CRON?.trim() || DEFAULT_REFRESH_CRON;
}
