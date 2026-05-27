# Columns Layout Spec

## Status

Draft

## Goal

Define Tau's coding-agent workspace columns, including the classic two-column
mode and an optional right detail column:

```text
[Navigation Sidebar] | [Chat Workspace] | [Detail Sidebar]
```

The chat remains the primary work surface. The right detail sidebar is used when
the user is inspecting important secondary information such as a sub-agent
result or future artifact.

## Modes

Tau has two main desktop workspace modes:

1. **Two-column mode**
   - Shows the existing left navigation sidebar and chat workspace.
   - The right detail sidebar is closed.
   - The workspace status float is visible by default in the upper-right of the
     chat area.

2. **Three-column mode**
   - Shows left navigation, chat workspace, and the right detail sidebar.
   - The workspace status float is hidden.
   - The right detail sidebar becomes the place for expanded secondary
     information.

The floating status card and the right detail sidebar are mutually exclusive.
Opening the right detail sidebar hides the float. Closing the sidebar may reveal
the float again according to the user's float visibility preference.

## Desktop Layout

In two-column mode:

- The left navigation keeps the current project/session browsing behavior.
- The chat workspace keeps the current reading and composing experience.
- The status float sits over the chat workspace as a lightweight overview.

In three-column mode:

- The right detail sidebar is a real third column, not an overlay card.
- The chat column may shrink, but messages must remain readable.
- The selected detail should remain visible while the chat continues updating.
- The sidebar must have an obvious close action that returns the workspace to
  two-column mode.

If width is constrained, opening the right sidebar may collapse the left
navigation so the chat and detail surfaces remain usable.

## Mobile and Narrow Screens

Mobile should not attempt a literal multi-column desktop layout.

Rules:

- The left navigation remains a drawer.
- The right detail view opens as a full-screen or near-full-screen sheet.
- The status float should not appear as a large floating card over mobile chat.
- Closing the detail view returns to chat without losing chat scroll position.

## Right Detail Sidebar

The right detail sidebar is feature-specific. It is not a generic context-item
renderer. Each feature owns its detail content rules in its own spec.

Initial supported detail:

- `subagent`: defined in `specs/subagent-integration.md`.

Likely future detail:

- `artifact`: generated file, report, plan, or preview.

Common sidebar rules:

- Show a header with the detail title, source label, status when relevant, and a
  close action.
- Keep long content in a scrollable body.
- Preserve the selected detail while new information arrives.
- Closing the sidebar hides the detail view but does not delete the underlying
  feature state.
- Provide copy/open actions only when they map to concrete content.
- On desktop, the boundary between the chat workspace and the right detail
  sidebar should be draggable so the user can adjust the sidebar width.
- The sidebar should keep a reasonable minimum width for metadata and a
  reasonable maximum width so the chat column remains usable.

## Visual Direction

- Keep the layout quiet, dense, and operational.
- Avoid large decorative panels or marketing-style sections.
- Use familiar icon buttons for close, copy, open, and related actions.
- Do not nest cards inside cards.
- Keep chat visually dominant even when the right sidebar is open.

## Non-Goals

- Do not introduce a generic context-item abstraction for the right sidebar.
- Do not expose raw event JSON as a user-facing detail view.
- Do not replace existing session, model, or settings controls.
