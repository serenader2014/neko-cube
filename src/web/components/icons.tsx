import type { ReactNode } from "react";

// Shared line-art glyph wrapper used across every module shell and toolbar.
// Previously this exact SVG was duplicated as ConfigGlyph / RuntimeGlyph /
// AnalyticsGlyph inside each page file.
export function Glyph({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="26" viewBox="0 0 24 24" width="26">
      <g stroke={active ? "#a9552b" : "#8b725f"} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9">
        {children}
      </g>
    </svg>
  );
}

type GlyphProps = { active: boolean };

/* ------------------------------------------------------------------ */
/* Config module tab icons                                            */
/* ------------------------------------------------------------------ */

export function ConfigOverviewGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M5 5h6v6H5z" />
      <path d="M13 5h6v4h-6z" />
      <path d="M13 11h6v8h-6z" />
      <path d="M5 13h6v6H5z" />
    </Glyph>
  );
}

export function SourcesGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M5 7h8" />
      <path d="M5 12h14" />
      <path d="M5 17h10" />
      <circle cx="17" cy="7" r="2" />
    </Glyph>
  );
}

export function GroupsGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <circle cx="7" cy="7" r="2.1" />
      <circle cx="17" cy="7" r="2.1" />
      <circle cx="7" cy="17" r="2.1" />
      <circle cx="17" cy="17" r="2.1" />
      <path d="M9.1 7h5.8M7 9.1v5.8M17 9.1v5.8M9.1 17h5.8" />
    </Glyph>
  );
}

export function ConfigRulesGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M6 6h12" />
      <path d="M6 12h8" />
      <path d="M6 18h6" />
      <path d="M16 16l2 2 3-4" />
    </Glyph>
  );
}

export function TargetGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" />
    </Glyph>
  );
}

export function ConfigDevicesGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect x="7" y="4" width="10" height="16" rx="2" />
      <path d="M10 7h4" />
      <path d="M11 17h2" />
    </Glyph>
  );
}

/* ------------------------------------------------------------------ */
/* Runtime module nav + toolbar icons                                 */
/* ------------------------------------------------------------------ */

export function HomeGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M4.5 10.5 12 4l7.5 6.5" />
      <path d="M6.5 9.5V19h11V9.5" />
      <path d="M10 19v-5h4v5" />
    </Glyph>
  );
}

export function NodeGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <circle cx="7" cy="7" r="2.2" />
      <circle cx="17" cy="7" r="2.2" />
      <circle cx="12" cy="17" r="2.2" />
      <path d="M8.7 8.4 10.6 14.5M15.3 8.4 13.4 14.5M9 7h6" />
    </Glyph>
  );
}

export function NetworkGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M5 18h14" />
      <path d="M7 14.5V9.2m5 5.3V5m5 9.5v-7" />
      <circle cx="7" cy="18" r="1" />
      <circle cx="12" cy="18" r="1" />
      <circle cx="17" cy="18" r="1" />
    </Glyph>
  );
}

export function DocGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M7 4.5h7l3 3V19H7z" />
      <path d="M14 4.5V8h3" />
      <path d="M9 11h6M9 14h6M9 17h4" />
    </Glyph>
  );
}

export function SettingsGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 4.5v2.2m0 10.6v2.2M19.5 12h-2.2M6.7 12H4.5m12.8 5.3-1.5-1.5M8.2 8.2 6.7 6.7m10.6 0-1.5 1.5M8.2 15.8l-1.5 1.5" />
    </Glyph>
  );
}

export function PauseGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M9 6.5v11M15 6.5v11" />
    </Glyph>
  );
}

export function PlayGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="m9 7 8 5-8 5z" />
    </Glyph>
  );
}

export function SortGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M7 7h10M7 12h7M7 17h4" />
      <path d="m17 15 2 2 2-2" />
      <path d="M19 8v9" />
    </Glyph>
  );
}

export function SortDescGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M7 7h10M7 12h7M7 17h4" />
      <path d="m17 15 2 2 2-2" />
      <path d="M19 8v9" />
    </Glyph>
  );
}

export function SortAscGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M7 7h10M7 12h7M7 17h4" />
      <path d="m17 9 2-2 2 2" />
      <path d="M19 7v9" />
    </Glyph>
  );
}

export function GroupOnGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect height="5" rx="1.2" width="5" x="4.5" y="4.5" />
      <rect height="5" rx="1.2" width="5" x="14.5" y="4.5" />
      <rect height="5" rx="1.2" width="5" x="9.5" y="14.5" />
      <path d="M9.5 7h5M12 9.5v5" />
    </Glyph>
  );
}

export function GroupOffGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect height="5" rx="1.2" width="5" x="4.5" y="4.5" />
      <rect height="5" rx="1.2" width="5" x="14.5" y="4.5" />
      <rect height="5" rx="1.2" width="5" x="9.5" y="14.5" />
      <path d="M9.5 7h5M12 9.5v5" />
      <path d="M6 18 18 6" />
    </Glyph>
  );
}

export function ClearGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M6 8h12" />
      <path d="M9 8V6.5h6V8" />
      <path d="m8 8 1 10h6l1-10" />
      <path d="M10.5 11.5v4M13.5 11.5v4" />
    </Glyph>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics module tab icons                                         */
/* ------------------------------------------------------------------ */

export function AnalyticsOverviewGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M4.5 18.5h15" />
      <path d="M6.5 15V10m5 5V6m5 9v-3" />
    </Glyph>
  );
}

export function AnalyticsRulesGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
      <path d="M8.8 8.4 10.8 15M15.2 8.4 13.2 15" />
    </Glyph>
  );
}

export function DomainsGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z" />
      <path d="M5 12h14M12 5a11 11 0 0 1 0 14M12 5a11 11 0 0 0 0 14" />
    </Glyph>
  );
}

export function RegionsGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <path d="M4.5 12h15" />
      <path d="M12 4.5c3 2.4 4.5 4.9 4.5 7.5S15 17.1 12 19.5C9 17.1 7.5 14.6 7.5 12S9 6.9 12 4.5Z" />
    </Glyph>
  );
}

export function ProxiesGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect height="5.5" rx="1.4" width="15" x="4.5" y="5" />
      <rect height="5.5" rx="1.4" width="15" x="4.5" y="13.5" />
      <path d="M8 7.75h.01M8 16.25h.01" />
    </Glyph>
  );
}

export function AnalyticsDevicesGlyph({ active }: GlyphProps) {
  return (
    <Glyph active={active}>
      <rect height="11" rx="2.2" width="8" x="4.5" y="6" />
      <path d="M8.5 15.5h.01" />
      <rect height="13" rx="2.2" width="7" x="13" y="5" />
      <path d="M16.5 15.8h.01" />
    </Glyph>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar (top-level module) icons — styled via CSS currentColor      */
/* ------------------------------------------------------------------ */

export type SidebarIconName = "config" | "runtime" | "analytics";

export function SidebarNavIcon({ name }: { name: SidebarIconName }) {
  if (name === "runtime") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M4 13h4l2-6 4 10 2-6h4" />
        <path d="M4 19h16" />
      </svg>
    );
  }

  if (name === "analytics") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M5 19V9" />
        <path d="M12 19V5" />
        <path d="M19 19v-7" />
        <path d="M4 19h16" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24">
      <path d="M5 6h14" />
      <path d="M5 12h14" />
      <path d="M5 18h10" />
      <path d="M17 16l2 2 3-4" />
    </svg>
  );
}
