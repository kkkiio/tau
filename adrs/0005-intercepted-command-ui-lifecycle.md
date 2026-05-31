# ADR 0005: Intercepted Extension Command UI Lifecycle

## Status

Draft

## Context

Pi Web UI's Web UI sends user prompts to Pi through a WebSocket connection. The
mirror-server extension receives `{ type: "prompt", message: "/discuss" }` and
calls `pi.sendUserMessage(message)`.

Extensions may intercept commands through two paths:

- **`pi.registerCommand`**: The framework expands `/discuss` before building
  messages. The command handler runs synchronously inside `prompt()` and returns
  early. No agent run starts.
- **`pi.on("input", ...)`**: When `sendUserMessage` is used (which sets
  `expandPromptTemplates: false`), the `input` event fires. If an extension
  handler returns `{ action: "handled" }`, `prompt()` returns early. Again no
  agent run starts.

When a command is intercepted, Pi emits no `agent_start`, `agent_end`, or
`message_start`(user) events. The mirror server sends back `{ type: "response",
command: "prompt", success: true }` — but the current frontend ignores
`response` messages entirely.

The frontend also optimistically adds the user message to the chat list and sets
`chatStatus` to `"submitted"` before the WebSocket send completes. It relies on
`agent_start` to transition to `"streaming"` and on `agent_end` to transition
back to `"ready"`. For intercepted commands, those events never arrive, leaving
the UI permanently stuck in `"submitted"` with a spinner on the submit button.

On the TUI side, intercepted commands are not displayed as user messages in the
chat history. The editor returns to idle immediately.

## Decision

### 1. User messages are event-driven, not optimistic

Remove the optimistic `setItems(...)` call from `sendPrompt`. The sole source of
truth for adding a user message to the chat list is the `message_start` event
with `role: "user"` emitted by Pi.

Remove the `lastSentRef` deduplication in the `message_start` handler — it is no
longer needed.

Consequence: intercepted commands produce no user message in the Web UI,
matching TUI behavior.

### 2. `chatStatus` transitions on `response` success

When the mirror server sends `{ type: "response", command: "prompt", success:
true }`, the frontend resets `chatStatus` from `"submitted"` to `"ready"`:

```typescript
if (data.type === "response" && data.success && data.command === "prompt") {
    setChatStatus(current => {
        if (current === "submitted") return "ready";
        return current; // already streaming, leave alone
    });
}
```

This allows intercepted commands to restore the input to idle without requiring
an `agent_end` event.

### 3. Guard against overwriting streaming state

JavaScript's single-threaded event loop guarantees that WebSocket messages are
processed sequentially. `response` always arrives before `agent_start` because
mirror-server calls `pi.sendUserMessage` (fire-and-forget) then immediately
sends the `response` — before the agent loop yields to emit `agent_start`.

The `current === "submitted"` guard exists for defensive correctness. If future
refactoring ever changes the send order, the guard prevents a late `response`
from incorrectly resetting an active streaming state.

## Message Timing

For a **normal prompt** (not intercepted):

```
mirror-server:  pi.sendUserMessage(message)
mirror-server:  sendTo(ws, success("prompt"))         ← response
agent-loop:     emit({ type: "agent_start" })          ← next microtask
agent-loop:     emit({ type: "message_start" }, user)  ← after agent_start
...
agent-loop:     emit({ type: "agent_end" })
```

Frontend WebSocket message order:

```
① response success    → chatStatus: submitted → ready
② agent_start         → chatStatus: ready → streaming
③ message_start(user) → add user message to list
④ ...
⑤ agent_end           → chatStatus: streaming → ready
```

For an **intercepted command** (e.g., `/discuss`):

```
mirror-server:  pi.sendUserMessage("/discuss")
                → input handler → { action: "handled" } → prompt() return
mirror-server:  sendTo(ws, success("prompt"))
```

Frontend WebSocket message order:

```
① response success    → chatStatus: submitted → ready
```

No user message is added. No further state transitions occur. Input is idle.

## Alternatives Considered

### A. Extension triggers a dummy agent turn on command interception

pi-discuss could call `pi.sendUserMessage(...)` when entering discussion mode
without a topic, triggering a full agent turn with `agent_start` → LLM response
→ `agent_end`.

Rejected. A mode switch is not a conversation event. Forcing an LLM call adds
unnecessary cost and latency with no user value.

### B. Extension emits a custom event via EventBus

pi-discuss could emit `discussion_mode_entered` / `discussion_mode_exited`
through `pi.events`. pi-web-ui could subscribe and forward to the Web UI.

Not mutually exclusive with this ADR. This is a better approach for rich UI
state (e.g., displaying a "💬 discussing" indicator in the Web UI), but it does
not address the core lifecycle issue: the frontend needs a signal that the
prompt was consumed without starting an agent run. Handling `response` solves
that generically for all intercepted commands, not just pi-discuss.

### C. Mirror server checks `pi.sendUserMessage` return value

Currently `pi.sendUserMessage` is fire-and-forget and returns `undefined`. The
Pi framework could be changed to return a promise that resolves with whether the
message was intercepted.

Rejected as out of scope for pi-web-ui. It would require a Pi framework change.

## Consequences

- The frontend no longer adds user messages optimistically. The `message_start`
  event is the single source of truth.
- `lastSentRef` deduplication is removed, simplifying the `message_start` user
  handler.
- Intercepted extension commands (like `/discuss`, `/discuss off`) do not leave
  orphaned user messages in the chat list. Behavior matches the TUI.
- The `response` message type is now handled, fixing the stuck-submitted state
  for any extension command that intercepts input without starting an agent run.
- Adding EventBus-based mode announcements (ADR to follow) is not blocked by
  this change.
