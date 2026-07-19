# CLAUDE.md

The full project overview, runtime modes, and code conventions live in
AGENTS.md. Read it before writing code.

@AGENTS.md

## Quick rules (most important)

- No source file over **1200 lines** — split into a feature folder first.
- Reuse existing components/helpers; never copy-paste (use `ModuleShell`,
  `components/icons.tsx`, `Modal`, `EChart`, feature `helpers.ts`, etc.).
- Large pages follow the `pages/<feature>/` layered structure
  (types → constants → helpers → charts → hooks → components → route pages),
  exposed only through `index.ts`. No circular imports.
- Before committing run `npm run lint && npm test`; fix lint errors
  (`npm run lint:fix`). Do not introduce new `npm run typecheck` errors.
