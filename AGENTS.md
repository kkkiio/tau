# Pi Web UI

Build a web-based chat UI for Pi (the coding agent).

## Architecture

- **Backend**: Node.js server that spawns `pi --mode rpc --no-session` as a subprocess
- **Frontend**: Single HTML page with vanilla JS (no framework needed)
- **Communication**: WebSocket between browser and server, JSON-RPC to Pi subprocess via stdin/stdout

## Key Requirements

1. Chat interface showing user messages and assistant responses
2. Tool call visualisation (show which tools the agent is using, with args and results)
3. Streaming text display (token by token as the agent responds)
4. Input box at the bottom to send messages
5. Clean, minimal design — dark theme

## Pi RPC Protocol

Pi's RPC mode reads JSON commands from stdin and writes JSON events to stdout.
Read the full protocol docs at: /opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md

## Pi SDK

The SDK can also be used directly in Node.js instead of RPC mode.
Read the SDK docs at: /opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md

## Operation Guide

Run before commit:

```bash
just fmt
just check
```

## Reference

- RPC docs: /opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md
- SDK docs: /opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md
- JSON mode docs: /opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/json.md
- Session docs: /opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md
