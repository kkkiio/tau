# Workspace Status Float Spec

## Status

Draft

## Goal

Add a Codex-style upper-right floating status card for the classic two-column
chat workspace. The float gives compact situational awareness without moving the
main chat.

The current version shows only `Subagents`, defined in
`specs/subagent-integration.md`. The component name remains
`WorkspaceStatusFloat` because this surface may later also host Artifacts, such
as plans or other important intermediate results.

The float is not a generic context-item browser. Each supported section should
present the specific information that matters for that section.

## Relationship to Columns Layout

The status float belongs only to the classic two-column mode.

Rules:

- When the right detail sidebar is closed, the float is visible by default.
- When the right detail sidebar opens, the float is hidden.
- The float and right detail sidebar are mutually exclusive surfaces.
- Clicking a row that needs expanded inspection opens the right detail sidebar
  and hides the float.

This keeps the float as a compact overview and avoids competing right-side
surfaces.

## Placement

Desktop:

- Position near the upper-right of the chat workspace.
- Keep it visually separate from the message stream without turning it into a
  full side panel.
- Do not cover the message composer.
- Do not show it while the right detail sidebar is open.

Mobile:

- Do not keep a large floating card over the chat.
- Use a compact trigger or sheet if the same information needs to be reachable.

## Visibility

In desktop two-column mode, the float is shown by default. If there are no
supported items yet, it should show a compact empty state instead of
disappearing.

## Sections

### Subagents

Shows compact Pi sub-agent activity. Row content, click behavior, and refresh
recovery rules live in `specs/subagent-integration.md`.

### Future Artifacts

Artifacts are planned but out of scope for the current version.

Rules:

- Artifacts should represent important intermediate results, such as a plan,
  generated report, or preview-worthy file.
- Artifact rows should be designed around their own useful information, not
  forced into a generic context-item shape.
- Adding Artifacts should not reintroduce environment or source status rows
  unless those become concrete product features.

## Attention Rules

The float or its trigger may show attention state.

Suggested rules:

- Running or queued items count as active.
- Failed, stopped, aborted, and completed items can request attention until
  opened.
- If an already-opened item receives new information later, it can request
  attention again.
- Acknowledgement is a UI behavior; it should not change the underlying
  sub-agent result.

## Non-Goals

- Do not make the float a universal context-item renderer.
- Do not show Progress, Environment, or Sources in the current version.
- Do not show raw event JSON as the primary float content.
- Do not add manual sub-agent spawning controls in the first version.
- Do not replace existing model, session, settings, or TUI management controls.
