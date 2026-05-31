# ADR 0001: Pi Extension Output Policy

## Status

Accepted

## Context

Pi Web UI runs as a Pi agent extension inside the same process and terminal as the Pi
interactive TUI. Plain writes to stdout or stderr, including `console.log`,
`console.warn`, and `console.error`, bypass Pi's renderer. When they happen
during TUI redraws they can move the cursor, scroll the terminal, and leave
messages visually interleaved with Pi's own UI.

The mirror server also receives frequent browser WebSocket connect and
disconnect events. Treating those events as terminal logs produces noisy output
and makes the terminal appear misaligned.

## Decision

Pi extensions in this repository must not write operational messages directly to
stdout or stderr.

Use Pi UI surfaces for user-visible information:

- `ctx.ui.notify(...)` for deliberate user-facing one-shot messages.
- `ctx.ui.setStatus(...)` for persistent runtime state such as server address,
  enabled/disabled state, or connected browser client count.
- Protocol responses or WebSocket messages for browser-facing errors.

Do not add ad hoc file logging in extension code. If we later need persistent
debug logs, we will introduce a small shared logging library that writes to a
dedicated debug log file and is gated by an explicit debug setting or
environment variable.

## Consequences

- Browser connect/disconnect churn is represented as state instead of terminal
  text.
- Extension diagnostics will not corrupt the Pi TUI.
- Debug logging remains intentionally absent until there is a shared abstraction
  with a clear file path, format, and opt-in switch.
