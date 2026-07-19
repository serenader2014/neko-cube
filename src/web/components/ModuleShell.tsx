import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

export type ModuleTab = {
  to: string;
  label: string;
  icon: (active: boolean) => ReactNode;
};

export type ModuleShellProps = {
  /** Small uppercase label above the title. */
  eyebrow: string;
  title: string;
  description: string;
  tabs: ModuleTab[];
  navLabel?: string;
  /** Right-aligned header content (status pills, range controls, …). */
  actions?: ReactNode;
  actionsClassName?: string;
  /** Banners rendered between the header and the routed screen. */
  banners?: ReactNode;
  /** Passed straight to the nested <Outlet> so sub-pages can read it. */
  outletContext?: unknown;
  pageClassName?: string;
  copyClassName?: string;
  screenClassName?: string;
};

/**
 * Shared chrome for the three top-level modules (Config / Runtime / Analytics).
 * Centralizes the header + tab nav + outlet that each module previously
 * hand-rolled. CSS class names are kept as-is (`runtime-shell-*`) so existing
 * styles apply unchanged; renaming them to neutral names is a follow-up that
 * now only touches this one file.
 */
export function ModuleShell({
  eyebrow,
  title,
  description,
  tabs,
  navLabel,
  actions,
  actionsClassName = "inline-actions shell-status runtime-shell-status",
  banners,
  outletContext,
  pageClassName,
  copyClassName,
  screenClassName,
}: ModuleShellProps) {
  return (
    <section className={`page runtime-shell-page${pageClassName ? ` ${pageClassName}` : ""}`}>
      <header className="page-header shell-page-header runtime-shell-header">
        <div className={`runtime-shell-copy${copyClassName ? ` ${copyClassName}` : ""}`}>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{description}</p>
          <nav aria-label={navLabel ?? `${title}导航`} className="runtime-header-tabs">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) => `runtime-header-tab ${isActive ? "is-active" : ""}`}
              >
                {({ isActive }) => (
                  <>
                    <span className="runtime-header-tab-glyph">{tab.icon(isActive)}</span>
                    <span>{tab.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
        {actions ? <div className={actionsClassName}>{actions}</div> : null}
      </header>

      {banners}

      <div className={`runtime-screen${screenClassName ? ` ${screenClassName}` : ""}`}>
        <Outlet context={outletContext} />
      </div>
    </section>
  );
}
