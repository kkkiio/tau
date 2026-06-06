# ADR 0003: Frontend Build Distribution Strategy for npm Publishing

## Status

Accepted (2026-06-06)

## Context

pi-web-ui contains a Vite+React frontend that compiles to `dist/` (~24MB, 666 files including Shiki syntax highlighting grammars). The package is installed via:

- `pi install npm:pi-web-ui` (npm registry, primary user path)
- `pi install git:github.com/kkkiio/pi-web-ui` (git clone, developer path)

We evaluated three approaches for distributing the compiled frontend.

### Constraints

- Pi package spec requires core packages (`@earendil-works/pi-coding-agent` etc.) in `peerDependencies`
- `npm install` as a dependency does NOT run `prepare` scripts; `npm install` in a cloned repo directory DOES
- `dist/` contains content-hashed filenames (e.g. `index-DB9Q-jBI.js`)

## Options Considered

### Option A: Build on Install

- `dist/` gitignored
- All build tools in `dependencies` (~200MB install)
- `prepare` builds on every install
- **Rejected**: shifts build tool download + compilation failure risk to end users

### Option B: Pre-build and Commit to Git

- `dist/` committed to repository
- Build tools in `devDependencies`, runtime deps only `ws` (~2MB)
- No build on install
- **Rejected as primary**: Shiki upgrades cause 600+ file diffs; long-term repo bloat; review noise from hash filenames

### Option C: Hybrid — Prepack + Prepare (Chosen)

- `dist/` gitignored — clean repository
- `dependencies`: `ws` only (runtime)
- `devDependencies`: all build tools (vite, react, tailwind, typescript, shiki, etc.)
- `peerDependencies`: `@earendil-works/pi-coding-agent` (provided by Pi host)
- `prepack`: `npm run build:web` — builds before `npm publish`, dist included in npm tarball
- `prepare`: `npm run build:web` — builds on `npm install` in cloned repo (git install path)
- `files`: explicit whitelist (`extensions/`, `dist/`, `public/`, `README.md`)

| Install Path | What Happens |
|---|---|
| `pi install npm:pi-web-ui` | Downloads tarball with pre-built `dist/` — no build needed |
| `pi install git:...` | Clones → `npm install` → `prepare` builds `dist/` automatically |
| Developer `npm install` | Same as git path — `prepare` builds for development |

## Decision

**Use Option C (Hybrid).** This is the standard npm distribution pattern used by prisma, husky, tailwindcss, and other widely-used packages.

Key implementation details:

1. **`files` field in `package.json`**: Required because `dist/` is gitignored — npm would otherwise exclude it from the tarball.
2. **`prepare` + `prepack`**: Both run the same build. `prepack` catches npm publish; `prepare` catches git installs and local development.
3. **`engines.node >= 18`**: Loose constraint — git installs trigger a build and need a reasonable Node version, but we don't block newer versions.

## Consequences

### Positive

- npm users get instant install with no build tools (~2MB vs ~200MB)
- Git history stays clean — no compiled artifacts
- `dependencies` / `devDependencies` / `peerDependencies` correctly separated
- Standard npm lifecycle pattern — tooling understands it

### Negative

- `prepare` runs on local `npm install`, which may surprise developers unfamiliar with the npm lifecycle (mitigated by README documentation)
- Must remember to run `build:web` before `npm publish` (handled by `prepack`)

## Migration Required

- [x] `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent` import migration
- [x] Dependency split: `ws` → `dependencies`, everything else → `devDependencies`
- [x] Add `peerDependencies`, `files`, `engines` to `package.json`
