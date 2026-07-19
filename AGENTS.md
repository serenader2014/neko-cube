# AGENTS.md

## Overview

This repository is a local Clash/Mihomo config management service.

Primary responsibilities:
- Aggregate upstream subscriptions.
- Build managed proxy groups, rules, and rule providers.
- Write compiled Clash/Mihomo YAML to disk.
- Optionally reload a local controller.
- Expose management flows through a web UI.

Tech stack:
- Backend: Node.js, TypeScript, Fastify, SQLite, Drizzle, Zod
- Frontend: React, Vite, React Router, TanStack Query, React Hook Form
- Tests: Vitest

Repository layout:
- `src/server`: API, runtime, persistence, jobs
- `src/shared`: schemas, defaults, compilation, subscription parsing
- `src/web`: management UI
- `src/test`: automated tests
- `scripts`: local development helpers

## Runtime Modes

### Safe local mode

Use this when you want isolated local data and no live controller side effects.

Commands:
- `npm run dev:local`
- `npm run dev:web:local`

Behavior:
- Uses the dev data namespace
- Scheduler is disabled
- Build/apply runs in safe mode

### Live local Mihomo mode

Use this for end-to-end validation against a repo-local Mihomo process.

Commands:
- `npm run dev:clash`
- `npm run dev:web:local`
- `npm run dev:mihomo`
- `npm run dev:mihomo:check`

Behavior:
- Uses the dev data namespace
- Backend serves the local dev API
- Writes generated config into `.dev/mihomo/`
- Reloads the repo-local Mihomo controller when enabled

## Dev Mihomo Notes

The repository supports an optional repo-local Mihomo environment under `.dev/mihomo/`.

Useful environment variables:
- `MIHOMO_BIN`
- `MIHOMO_HOME`
- `MIHOMO_CONFIG`
- `MIHOMO_CONTROLLER`
- `MIHOMO_SECRET`
- `DEV_MIHOMO_SECRET`

Notes:
- `.dev/` is ignored and should stay untracked.
- Scripts do not assume a fixed secret anymore; pass one explicitly when needed.
- If no secret is configured, the helper scripts talk to the controller without an auth header.

## Validation Workflow

Recommended local validation flow:
1. Start Mihomo: `npm run dev:mihomo`
2. Start backend: `npm run dev:clash`
3. Start frontend: `npm run dev:web:local`
4. Check controller: `npm run dev:mihomo:check`
5. Trigger build/apply from the UI or API

Useful endpoints:
- `GET /api/dashboard`
- `GET /api/clash-target`
- `GET /api/config/preview`
- `GET /subscriptions/:token/clash.yaml`

## Defaults And Persistence

Persistence lives in SQLite via Drizzle.

Relevant files:
- `src/server/db/database.ts`
- `src/server/db/schema.ts`
- `src/shared/defaults.ts`

Behavior:
- First start seeds only minimal application defaults.
- Most operational data is database-driven after initialization.
- Changing `DEFAULT_*` constants does not rewrite an existing database unless explicit migration code exists.

## Frontend Notes

The frontend uses a Vite dev server with API proxying for local development.

Relevant file:
- `vite.config.ts`

When touching UI around long tokens, URLs, YAML, or card lists:
- Check overflow and wrapping.
- Check modal layout on narrow widths.
- Re-test empty states because this app now starts with minimal seeded data.

## Tests

Run:
- `npm test`
- `npm run build`

Coverage currently includes:
- Subscription parsing
- Config compilation
- Job service behavior
- Local dev runtime wiring

## Guardrails

- Do not commit `.dev/`, `data/`, or `dist/`.
- Prefer relative paths in docs and examples.
- Avoid hardcoded personal infrastructure, secrets, or machine-specific paths.
- Keep local-development helpers opt-in through environment variables.

## Code Conventions (read before writing code)

These are enforced by tooling; follow them so changes pass the gates.

### File size

- Hard limit: **no source file over 1200 lines** (ESLint `max-lines`, error).
- Before adding code to a file, check its length. If it is approaching ~1000
  lines, split it first rather than growing it.
- Soft limit: functions/components over ~400 lines warn (`max-lines-per-function`).
  Long components are a signal to extract sub-components or a custom hook.

### Reuse over duplication

- Do not copy-paste components, helpers, or option builders. If you need the
  same UI/logic twice, extract it once and import it. (`sonarjs/no-identical-functions` flags duplicates.)
- Shared UI lives in `src/web/components/`. Shared cross-page logic lives in
  `src/web/lib/`. Per-feature logic lives in that feature folder's `helpers.ts`.
- Reuse the existing primitives before inventing new ones: `ModuleShell`
  (page chrome), `src/web/components/icons.tsx` (all SVG glyphs), `Modal`,
  `StatusSwitch`, `SortListModal`, `EChart`, `toast`.

### Feature-folder structure for pages

Large pages are organized as a folder under `src/web/pages/<feature>/` with a
single-direction dependency layering (no cycles — `import-x/no-cycle`, error):

```
types.ts        → pure type aliases
constants.ts    → constant values (may import types)
helpers.ts      → pure functions (may import types/constants)
charts.ts       → ECharts option builders (pure)
hooks.ts        → custom hooks
use<Feature>Shell.ts → outlet-context hook
<Cards|Tables>.tsx   → presentational components
<Feature>Page.tsx    → route/layout components (shell, sub-pages)
index.ts        → barrel; App.tsx imports only from here
```

Other features must import a feature only through its `index.ts`, never reach
into its internal files.

### Imports

- No unused imports/vars (`unused-imports/no-unused-imports`, error). Run
  `npm run lint:fix` to clean them automatically.
- Use the `@shared/*` and `@web/*` path aliases (resolved by both Vite and tsc).

## Engineering Tooling

- `npm run lint` — ESLint gate (file size, dead imports, cycles, react-hooks,
  duplicate code). Must be error-free.
- `npm run typecheck` — `tsc --noEmit` for the web app (server is covered by
  `build:server`).
- `npm test` / `npm run build` — Vitest + production build.
- A husky pre-commit hook runs `lint-staged` (eslint --fix on staged files).
- CI (`.github/workflows/ci.yml`) runs lint + test + build on every PR.

Before committing, run `npm run lint && npm test`.

## Known Tech Debt

Tracked so it shrinks over time — do not add to these lists:

- `npm run typecheck` reports ~45 pre-existing type errors (root cause: the
  `ParsedProxy` return typing in `lib/config-fragments.ts` / `lib/proxy-catalog.ts`).
  The CI typecheck step is non-blocking until these are fixed; do not add new
  type errors.
