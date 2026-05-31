# Multi-Session Daemon Design (Archived)

> **Archived.** This exploration was superseded by [ADR 0006](../adrs/0006-project-scope-single-session-web-ui.md),
> which scopes the project to a single-session web UI. Preserved for reference.

## Summary

Explored introducing a daemon server to manage multiple Pi agent sessions from a single web UI, including:
- Standalone daemon process (`pi-web-ui serve`)
- macOS launchd integration
- Hybrid proxy mode for terminal Pi instances
- Reference: OpenCode's `opencode serve` architecture

## Why not

The daemon belongs at the Pi level (`pi serve`), not in a Pi extension. Extensions run inside a single Pi process — process management crosses the extension boundary. See ADR 0006 for full rationale.
