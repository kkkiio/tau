# Tau

A web UI that mirrors your [Pi](https://github.com/badlogic/pi-mono) terminal session in the browser. No separate server — it runs as a Pi extension inside your existing process.

## What it does

Tau connects to your running Pi TUI and gives you a second view in the browser. Same session, same messages, same tools — just a different screen. Type in the terminal or the browser, both stay in sync.

- **Live mirroring** — streams messages, tool calls, and thinking blocks in real-time
- **React UI** — built with Vite, Tailwind, shadcn/ui, and AI Elements
- **Markdown rendering** — uses Streamdown through AI Elements for streaming Markdown, code blocks, math, and Mermaid support
- **No extra process** — the Pi extension *is* the server

## Install

```bash
pi install npm:tau-mirror
```

Or from git:

```bash
pi install git:github.com/deflating/tau
```

## Usage

1. Start Pi normally in your terminal
2. Open the URL shown in the status bar (default: `http://localhost:3001`)
3. That's it

Type `/qr` in the terminal to show a QR code and scan it to access via your phone.

## Features

### Chat
- AI Elements conversation and message components
- Streamdown Markdown rendering with syntax-highlighted code blocks
- Live streaming text and thinking/reasoning blocks
- Tool call display using AI Elements tool components
- Image attachments with paste, drop, previews, and resizing before send
- Queued follow-up messages while the agent is streaming
- Scroll-to-bottom behavior from AI Elements conversation

### Model & Thinking
- Current model label
- Searchable model picker
- Thinking level cycle button
- Settings for thinking level and thinking-block visibility
- Session cost display
- Context-window visualisation and compact suggestion

### Sessions & Projects
- Session sidebar with grouped projects, favourites, live-session markers, rename, and search
- Historical session viewing in read-only mode
- Project launcher for configured `tau.projectsDir`

### Commands & Settings
- Command palette for compact, export HTML, session stats, and tool expand/collapse
- Light, dark, and system theme modes
- Auto-compaction and HTTP Basic Auth toggles when supported by the extension
- Extension UI dialogs for select, confirm, input, editor, and notifications

The React frontend intentionally does not migrate the old File Browser, old multi-theme picker, or voice input. Light/dark/system theme support is kept.

## Configuration

Environment variables (set before starting Pi):

| Variable | Default | Description |
|----------|---------|-------------|
| `TAU_MIRROR_PORT` | `3001` | Server port |
| `TAU_STATIC_DIR` | *(bundled)* | Override static files path |
| `TAU_DISABLED` | `0` | Set to `1` to disable Tau (it stays installed but won't start the server) |
| `TAU_USER` | *(none)* | HTTP Basic Auth username (both `TAU_USER` and `TAU_PASS` required to enable) |
| `TAU_PASS` | *(none)* | HTTP Basic Auth password |

### Authentication

Tau supports optional HTTP Basic Auth (browser-native login popup).

**1. Set credentials** — add to `~/.pi/agent/settings.json`:

```json
{
  "tau": {
    "user": "pi",
    "pass": "your-password"
  }
}
```

Or via environment variables: `TAU_USER=pi TAU_PASS=secret pi`

**2. Toggle on/off** — use the React settings panel when credentials are configured, or set `tau.authEnabled` in `~/.pi/agent/settings.json` before starting Pi.

Both HTTP and WebSocket connections are gated when enabled. The `/api/health` endpoint remains open for monitoring.

### Start / Stop

Control Tau at runtime without uninstalling:

```
/tau-stop     Stop the mirror server
/tau-start    Start it again
```

To prevent Tau from auto-starting (e.g. in multi-session or dev container workflows):

```bash
TAU_DISABLED=1 pi
```

You can still start it manually with `/tau-start` in that session.

## How it works

Tau is a [Pi extension](https://github.com/badlogic/pi-mono#extensions) that starts an HTTP + WebSocket server inside the Pi process. The extension subscribes to all Pi events and forwards them to connected browser clients. Commands from the browser are executed via the extension API against the same agent session.

```
┌─────────────┐     ┌──────────────────────────────┐     ┌─────────────┐
│  Pi TUI     │     │  Pi Process                  │     │  Browser    │
│  (terminal) │◄───►│                              │◄───►│  (Tau)      │
│             │     │  tau extension               │     │             │
└─────────────┘     │    ↳ HTTP + WS on :3001      │     └─────────────┘
                    └──────────────────────────────┘
```

There's no separate server to run. The extension auto-loads when Pi starts and shuts down when Pi exits.

## Development

Clone, install dependencies, and build the React web UI:

```bash
git clone https://github.com/deflating/tau.git
cd tau
npm install
npm run build:web
TAU_STATIC_DIR=$(pwd)/dist pi
```

The current Web UI source lives in `src/web`. `public/` only contains static assets copied by Vite, such as icons and the manifest.

For frontend development, run Pi with Tau on its normal port in one terminal, then run:

```bash
npm run dev:web
```

Open `http://localhost:4444`; Vite serves the React UI and proxies `/api` and `/ws` to the Tau extension on `localhost:3001`.

## License

MIT
