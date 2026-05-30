# ADR 0004: Web UI Access Bind Address

## Status

Accepted

## Context

Tau starts an HTTP + WebSocket server inside the Pi process to serve the web UI
and forward Pi events to connected browsers. The server currently binds to
`0.0.0.0`, which makes it accessible from any network interface — LAN,
Tailscale, and potentially the public internet if no firewall blocks the port.

The primary use case for Tau is **local development**: a developer runs Pi in
their terminal and opens the web UI in a browser on the same machine.
Remote access (mobile, Tailscale) is a secondary scenario that not all users
need.

The current code also includes ~40 lines of LAN and Tailscale IP detection
logic that constructs display URLs from detected network interfaces. When the
server binds to `127.0.0.1`, those detected IPs are unreachable, making the
detection and display misleading.

## Decision

1. **Default bind address: `127.0.0.1`** — the HTTP server listens only on the
   loopback interface by default, making the web UI accessible from the local
   machine only.

2. **New environment variable `TAU_MIRROR_HOST`** — users who need remote
   access can set this to `0.0.0.0` (or a specific IP) to restore the previous
   behavior.

   ```bash
   TAU_MIRROR_HOST=0.0.0.0 pi
   ```

3. **Remove LAN IP detection** — the `onListening` callback will no longer
   scan network interfaces (en0, en1, etc.) to find a display IP. The display
   URL will use the configured `TAU_MIRROR_HOST` directly.

4. **Remove Tailscale IP detection** — the `100.x.x.x` address detection,
   `tailscaleUrl`, and Tailscale status display are removed. If a user wants
   remote access via Tailscale, they should:
   - Set `TAU_MIRROR_HOST=127.0.0.1` (default)
   - Use `tailscale serve --bg <port>` to expose the local service on their
     tailnet
   
   Future ADRs may add automatic `tailscale serve` detection if demand arises.

5. **Vite dev server also binds to `127.0.0.1`** — `vite.config.ts` and
   `package.json` scripts change `--host 0.0.0.0` to `--host 127.0.0.1` for
   consistency with the production server.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TAU_MIRROR_HOST` | `127.0.0.1` | Bind address for the HTTP/WS server |
| `TAU_MIRROR_PORT` | `3001` | Port (unchanged) |

Both can also be set in `~/.pi/agent/settings.json` under `tau.host` and
`tau.port`.

## Consequences

- **More secure by default** — no accidental exposure to LAN or public networks.
- **Simpler code** — ~40 lines of network interface detection removed.
- **Explicit opt-in for remote access** — users who need LAN or Tailscale
  access set `TAU_MIRROR_HOST=0.0.0.0` explicitly.
- **Mobile use case preserved** — users can still access Tau from mobile
  devices by setting `TAU_MIRROR_HOST=0.0.0.0` or using `tailscale serve`.
- **QR code and `/tau` command** — automatically use the new URL; no separate
  change needed.

## Alternatives Considered

### A. Keep `0.0.0.0` as default, add a flag to restrict

Rejected. The project's primary use case is local development. Secure defaults
are preferable.

### B. Bind to `0.0.0.0` but add authentication by default

Rejected. HTTP Basic Auth is already supported but not enabled by default.
Binding to `0.0.0.0` without auth is the worst combination. Making auth
mandatory for non-localhost binds would add complexity.

### C. Detect LAN IP but only use it when bound to `0.0.0.0`

Rejected. Adds conditional complexity to the IP detection code for a secondary
use case.
