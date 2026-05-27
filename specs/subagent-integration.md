# Sub-Agent Integration Spec

## Status

Draft

## Goal

Show Pi sub-agents as first-class workspace activity in Tau:

- A compact `Subagents` section in `WorkspaceStatusFloat`.
- A right detail sidebar for one selected sub-agent's result and metadata.
- Refresh and history recovery for foreground `Agent` tool calls.

This spec covers UI behavior and product rules. Event transport rules stay in
`adrs/0002-web-ui-extension-event-protocol.md`.

## Supported Sources

Tau should build sub-agent UI state from live events and durable session history.

Live sources:

- `subagents:*` extension events forwarded by Mirror Server.
- Pi `tool_execution_update` and `tool_execution_end` events for the `Agent`
  tool.

History sources:

- Assistant messages containing an `Agent` tool call.
- Matching `toolResult` messages for the `Agent` tool.
- Durable custom entries such as `subagents:record` or
  `subagent-notification`, when the extension writes them.

Foreground `Agent` tool calls must be recoverable after refresh even if no live
extension event is replayed. Background and scheduled sub-agents are recoverable
only when the extension writes durable entries or provides a snapshot event.

## Sub-Agent State

The Web UI should maintain a sub-agent display model with these fields when
available:

- Stable id. Use `details.agentId` for completed foreground agents when present;
  use the tool call id as a temporary id for unmatched foreground calls.
- Type or display name, such as `Explore`, `Plan`, or `general-purpose`.
- Short description.
- Status.
- Source: foreground, background, scheduled, event, or history.
- Final response.
- Error text.
- Result preview.
- Tool count.
- Duration.
- Token totals.
- Compaction count.
- Transcript or output file path.
- Last updated timestamp for sorting.

Status values:

- `queued`: created but not yet running.
- `running`: active foreground or live child agent.
- `background`: background work accepted but not actively represented as a
  foreground turn.
- `completed`: finished with a final response.
- `steered`: finished after a steering handoff.
- `aborted`: interrupted by user or host.
- `stopped`: stopped by policy or scheduler.
- `error`: failed with an error.

Terminal statuses should not be replaced by later non-terminal updates.

## Float UI

The `WorkspaceStatusFloat` currently shows only `Subagents`.

Visibility:

- Show in desktop two-column mode when the right detail sidebar is closed.
- Hide when a right detail sidebar is open.
- Do not show as a large floating card on narrow screens.
- If there are no sub-agents, show a compact empty state.

Section header:

- Label: `Subagents`.
- Count: total known sub-agents when greater than zero.

Rows:

- Show the most recent sub-agents first.
- Each row shows status, type, description, and one compact metric or preview.
- Prefer tool count, token total, duration, error state, or result preview as
  the compact metric.
- Do not render long final responses in the float.

Row interaction:

- Rows with a final response or error are clickable.
- Clicking a row selects that sub-agent, opens the right detail sidebar, and
  hides the float.
- Rows without inspectable detail may remain non-clickable while still showing
  running state.

## Right Detail Sidebar UI

The right detail sidebar follows the container rules in
`specs/columns-layout.md`. When the selected detail is a sub-agent, it should
show:

- Header with description or type, type/status label, close action, and copy
  action when there is copyable response text.
- Metric grid with status, tool count, duration, and token total.
- Compaction count when available.
- Final response rendered as Markdown-rich text.
- Error text for failed, stopped, or aborted sub-agents.
- Transcript or output file path when available.

The final response belongs in the detail sidebar, not in the float. Long content
must scroll inside the sidebar body without moving the chat header or composer.

## Refresh And History Loading

When the Web UI receives a `mirror_sync` snapshot or opens a saved session from
the left sidebar, it should rebuild sub-agent state from session entries.

Rules:

- An assistant `Agent` tool call creates a foreground row with temporary id,
  type, description, running status, and timestamp.
- The matching `Agent` `toolResult` updates that row with terminal status,
  stable agent id, final response, tool count, duration, and error state.
- If the result text begins with the standard `Agent completed...` prelude, the
  prelude should be stripped from the displayed final response.
- If a call has no matching result yet, keep it as running.
- Durable extension records may add or update background/scheduled rows.

## Attention Rules

Suggested rules:

- Running or queued agents count as active.
- Completed, failed, stopped, or aborted agents may request attention until
  opened.
- If an opened agent receives new information later, it may request attention
  again.
- Acknowledgement is UI state only; it must not mutate the underlying result.

## Non-Goals

- Do not add manual sub-agent spawning controls in this version.
- Do not expose raw event JSON as a user-facing view.
- Do not make sub-agents a generic context-item abstraction.
- Do not require Mirror Server to synthesize display state.
