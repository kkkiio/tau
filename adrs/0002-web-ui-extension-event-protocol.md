# ADR 0002: Raw Web UI Event Forwarding

## Status

Draft

## Context

Pi Web UI currently forwards a fixed set of Pi lifecycle events from `pi.on(...)` to
the browser. This is intentionally close to the source event stream: the Web UI
receives Pi message/tool events and decides how to render them.

The next integration target is `@tintinweb/pi-subagents`. It emits its own
events through `pi.events`, such as `subagents:created`,
`subagents:started`, `subagents:completed`, and `subagents:failed`.

The initial design considered projecting these events inside Mirror Server into
a generic `ContextItem` model. That would make Mirror Server own UI semantics.
This is the wrong split. The issue is not that Mirror Server can never change:
adding a small subscription list for a newly supported extension is acceptable.
The boundary is that Mirror Server must not interpret extension payloads into
Pi Web UI product concepts.

## Decision

Mirror Server should remain a thin event transport. It may subscribe to known
event sources, but it should not translate extension events into UI models.

For WebSocket delivery, Pi Web UI will preserve:

- The original event/channel name.
- The original event payload, unchanged except for JSON serialization.
- The ordering in which Mirror Server observes events.

The browser-side app owns feature-specific interpretation. For example,
sub-agent display rules live in `specs/subagent-integration.md`.

## Transport Shape

Pi core events continue to use the existing protocol:

```json
{
  "type": "event",
  "event": {
    "type": "tool_execution_end",
    "toolCallId": "toolu_...",
    "toolName": "Agent",
    "result": {}
  }
}
```

Extension event-bus events should use the same top-level WebSocket message kind,
but keep the extension payload nested so event payload fields do not collide with
Pi Web UI's `event.type` field:

```json
{
  "type": "event",
  "event": {
    "type": "subagents:completed",
    "payload": {
      "id": "agent_123",
      "type": "Explore",
      "description": "Find auth files",
      "status": "completed",
      "toolUses": 5,
      "durationMs": 12300,
      "tokens": { "input": 12000, "output": 800, "total": 12800 },
      "result": "..."
    }
  }
}
```

This preserves the source event. In the Web UI, `event.type` is the event name
and `event.payload` is exactly what the extension emitted.

## Forwarding Rules

Mirror Server may do only transport-safe work:

- Subscribe to an event source.
- Wrap the observed event in Pi Web UI's WebSocket transport envelope.
- Ensure the payload is JSON-serializable.
- Optionally drop or truncate values that cannot be serialized safely.

Mirror Server must not:

- Infer UI state such as "context item", "artifact", or "detail item".
- Rename extension-specific fields.
- Derive display summaries.
- Merge multiple extension events into one UI event.
- Reach into extension internals such as raw sessions or managers.

## Event Discovery

Pi's `pi.events` event bus does not currently provide a wildcard subscription.
That creates a real constraint: Mirror Server cannot automatically hear every
possible future extension event unless those extensions emit through a shared
channel.

There are two acceptable patterns. Pattern A is sufficient for the current
`pi-subagents` integration.

### Pattern A: Known Source Channels

For an extension that emits named channels, Mirror Server subscribes to a small
explicit allowlist and forwards each payload unchanged.

This is the default path for `pi-subagents` and for future extensions where a
small Mirror Server subscription update is acceptable.

### Pattern B: Shared Pi Web UI Event Channel

For extensions that want to avoid adding a new Mirror Server subscription, emit
a Pi Web UI-visible event through a common channel:

```ts
pi.events.emit("tau:web:event", {
  type: "my-extension:item_updated",
  payload: {
    id: "item_123",
    status: "running"
  }
});
```

Mirror Server subscribes to `tau:web:event` once and forwards it as:

```json
{
  "type": "event",
  "event": {
    "type": "my-extension:item_updated",
    "payload": {
      "id": "item_123",
      "status": "running"
    }
  }
}
```

This is optional. It keeps Mirror Server subscription code smaller, but the
extension must opt into the shared channel convention.

## pi-subagents Data Sources

For the current `pi-subagents` package, Mirror Server may forward known
`subagents:*` channels unchanged. The Web UI should also learn from Pi session
entries:

- `subagents:*` extension events for live lifecycle updates.
- Pi `Agent` tool execution events for foreground tool results.
- `custom_message` entries with `customType: "subagent-notification"` for
  background/group completion display details.
- `custom` entries with `customType: "subagents:record"` for persisted completed
  agent reconstruction.

These are not `pi.events` events. They should be handled from `mirror_sync`
entries and from normal message lifecycle events if Pi emits custom messages
through `message_start` / `message_end`.

Foreground `Agent` tool calls are a separate case. `pi-subagents` emits
`subagents:started` for them, but terminal foreground results arrive as the
normal `tool_execution_end` result for the `Agent` tool. The Web UI should merge
that tool result by `result.details.agentId` rather than expecting a
`subagents:completed` event for foreground agents.

For refresh and saved-session viewing, the Web UI should also reconstruct
foreground agents from durable Pi message history: assistant `Agent` tool calls
provide the temporary row and matching `toolResult` messages provide terminal
status, final response, metrics, and stable `details.agentId` when present. This
keeps Mirror Server in a transport role while still making foreground sub-agent
rows recoverable without replaying live events.

The UI behavior for these sources is specified in
`specs/subagent-integration.md`.

## Recommended Extension Event Design

Extensions that want to render well in Pi Web UI should emit self-contained,
namespaced, JSON-safe events.

Recommended rules:

- Event names should be namespaced: `source:action`, e.g.
  `subagents:completed`, `tasks:updated`, `git:diff_changed`.
- Every lifecycle entity should have a stable `id`.
- Every event should include enough fields for the Web UI to update from that
  event alone.
- Terminal events should include final result/error fields where appropriate.
- Payloads should use plain JSON values only.
- Long text is allowed, but extensions should include a compact summary if they
  want a compact UI row.
- If state matters after reconnect, provide either persisted session entries or
  a snapshot/list event.

Example lifecycle:

```json
{ "id": "agent_123", "type": "Explore", "description": "Find auth files" }
```

```json
{
  "id": "agent_123",
  "type": "Explore",
  "description": "Find auth files",
  "status": "completed",
  "result": "Found 5 files...",
  "toolUses": 5,
  "durationMs": 12300
}
```

## Alternatives Considered

### A. Mirror Server Projects Generic Context Items

Mirror Server would convert extension payloads into generic context items.

Rejected. It creates a second place to update when UI semantics change and
makes Mirror Server too aware of product features.

### B. Mirror Server Raw Forwards Source Events

Mirror Server forwards event names and payloads only.

Accepted. It keeps the transport simple and puts feature behavior in the Web UI.

### C. Web UI Only Reads Session History

The Web UI could avoid extension events and reconstruct everything from session
entries.

Rejected for live UI. Session entries are useful for reconnect and history, but
they are not enough for timely running-state updates.

Foreground Pi `Agent` tool calls are the exception for refresh recovery: their
ordinary assistant tool call and matching `toolResult` entries are durable
session history, so the Web UI can reconstruct completed foreground sub-agent
rows from those entries after a page refresh. This does not replace live events
for running-state updates.

## Consequences

- Adding support for a new extension may require a small Mirror Server
  subscription update.
- Adding or changing UI behavior should remain a Web UI change.
- Existing extension event shapes stay visible to the browser.
- Mirror Server still needs either explicit channel subscriptions for legacy
  extension events or one shared Pi Web UI event channel for future extensions.
- The Web UI must tolerate unknown event types and ignore events it does not
  understand.
- Reconnect behavior depends on event replay, session entries, or extension
  snapshot events. This should be handled per feature, not by a generic context
  item cache in Mirror Server.
