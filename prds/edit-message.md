# PRD: Edit Message

## Problem Statement

Pi 的 session 支持树形分支，用户可以通过 `/tree` 回退到任意用户消息并重新开始对话。但在 Pi Web UI Web UI 中，用户只能查看消息和复制文本，无法从浏览器端发起分支操作。如果想修改一条之前的 prompt 重新提问，用户必须回到终端手动操作。

## Solution

在 Pi Web UI Web UI 的用户消息上增加"编辑"功能，用户点击后可以在输入框中修改消息内容并重新提交，自动从原消息位置创建新分支。

## User Stories

1. 作为 Pi Web UI 用户，我希望在聊天界面点击任何一条我发送过的消息旁的编辑按钮，这样我就能快速修改之前的 prompt。

2. 作为 Pi Web UI 用户，我希望点击编辑后消息文本在原地变成可编辑的文本框，这样我可以在消息的原始位置直接修改，而不是跳到页面底部的输入框。

3. 作为 Pi Web UI 用户，我希望编辑后提交的消息从原来的位置重新开始一段对话分支，而不是追加到当前对话末尾，这样原分支继续保留，新分支独立发展。

4. 作为 Pi Web UI 用户，我希望每条用户消息上都始终显示编辑按钮，当功能不可用时按钮置灰并 hover 提示原因（"Run /webui in terminal to enable editing"），这样我始终知道编辑功能存在且理解如何启用它。

5. 作为 Pi Web UI 用户，当 agent 正在生成回复时，我不应该能够发起编辑操作，以免中断当前对话。

## Implementation Decisions

### 两步协议

编辑提交使用两步 WS 协议：

1. `navigate_tree` — 将 session 树导航到目标用户消息
2. `prompt` — 发送编辑后的文本

两步间用 `response` 消息确认导航成功后再发 prompt。导航失败时不发送编辑文本。

### navigateTree 获取方式

`navigateTree` 仅在 Pi 的命令上下文中可用。Pi Web UI 在 `/webui` 命令 handler 中捕获该闭包，存储为模块级变量供 WS handler 使用。`session_start` 时清空。详见 ADR 0003。

### UI 状态同步

导航完成后服务端发送 `mirror_sync` 快照覆盖客户端条目列表，清除废弃分支的残留条目。新分支的 assistant 回复通过正常的流式事件增量追加。

### `buildStateSnapshot` 修正

快照构建从 `getEntries()`（返回全部条目含废弃分支）改为 `getBranch()`（仅返回当前 root-to-leaf 路径）。此修改影响所有同步场景，属于正确性修复。

### advancedFeatures 标志

新增 `state` WS 消息携带 `advancedFeatures: boolean` 标志，表示编辑功能是否可用。编辑按钮始终显示在用户消息上：可用时正常可点击，不可用时置灰并显示说明 tooltip。

## Out of Scope

- 不支持编辑 assistant 或系统消息
- 不修改原始消息，始终创建新分支
- 不提供撤销导航的操作
- 不显示分支预览
- 导航前后不展示确认对话框

## Further Notes

- 如果 Pi 未来将 `navigateTree` 加入 `ExtensionContext`，可以移除 `/webui` 捕获的 workaround
- 两步协议理论上可以合并为一步服务端事务，但需 Pi 支持同时完成导航和发送
