# Implementation Plan: tau-mirror → pi-web-ui

## Phases

### Phase 1: Rename

| Area | Old | New |
|------|-----|-----|
| npm package | `tau-mirror` | `pi-web-ui` |
| Env var prefix | `TAU_` | `PI_WEB_UI_` |
| Settings key | `tau.*` | `pi-web-ui.*` |
| Pi commands | `/tau`, `/taustart`, `/taustop` | `/webui`, `/webui-start`, `/webui-stop` |
| Source dirs | `src/web/src/tau/`, `components/tau/` | `src/web/src/core/`, `components/pi-web-ui/` |
| UI strings | "Tau", "Mirror:" | "Pi Web UI", "pi-web-ui:" |
| Status key | `"mirror"` | `"webui"` |
| WS mode | `"mirror"` | `"webui"` |

### Phase 2: Remove instance registry

Delete `~/.pi/tau-instances/` mechanism:
- `INSTANCES_DIR`, `RunningInstance`, `registerInstance()`, `unregisterInstance()`, `updateInstanceSession()`, `getRunningInstances()`, `cleanupZombieInstances()`
- `/api/instances` endpoint
- Frontend `liveInstances`, `liveFiles`, `RunningInstance` type

### Phase 3: Remove HTTP Basic Auth

Delete auth system:
- `AUTH_USER/PASS`, `authEnabled`, `checkBasicAuth()`, `sendAuthRequired()`
- Auth checks in HTTP/WS handlers
- `get_auth`/`set_auth` commands, auth toggle in settings panel

### Phase 4: Sidebar redesign

- Remove "Projects" tab and `ProjectLauncher` component
- "Sessions" → "History" with flat list (no project grouping)
- Active session summary at top (cwd, model, status)
- Move hamburger button from main panel to sidebar

## Before vs After (Sidebar)

```
BEFORE                              AFTER
┌──────────────────┐              ┌──────────────────┐
│ Tau  Pi mirror   │              │ Pi Web UI     ☰ │
│ [Sessions][Projects]│            │ Browser for Pi   │
│ Search...        │              │                  │
│                  │              │ ● /path/to/proj  │
│ /project-a ──    │              │   Claude Sonnet  │
│   Session 1 ⭐   │              │   ● streaming    │
│   Session 2 ●    │              │                  │
│ /project-b ──    │              │ ─ History ───────│
│   Session 3      │              │   Search...      │
│                  │              │   Session 1 ⭐   │
│ [Settings]       │              │   Session 2      │
└──────────────────┘              │   Session 3      │
                                  │                  │
                                  │ [Settings]       │
                                  └──────────────────┘
```

## Files affected

```
package.json                              # Rename
extensions/mirror-server.ts              # Rename + Phase 2 + Phase 3
src/web/index.html                        # Rename
src/web/src/app.tsx                       # Rename + Phase 4
src/web/src/core/*                        # Rename (dir move)
src/web/src/components/pi-web-ui/*        # Rename (dir move)
src/web/src/main.tsx                       # Import path updates
README.md                                  # Rewrite + fork ack
AGENTS.md                                  # Rename
adrs/0001-*.md                             # Rename Tau references
adrs/0002-*.md                             # Rename Tau references
adrs/0004-*.md                             # Rename env var names
adrs/0005-*.md                             # Rename project name
adrs/0006-*.md                             # New: scope decision
docs/design/multi-session-daemon.md        # Archive + rename refs
```
