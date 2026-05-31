# PRD: Sub-Agent Integration

## Problem Statement

当 Pi 在使用 Agent 工具调用子 agent 时（如 Explore、Plan、general-purpose），用户在 Pi Web UI Web UI 中无法感知子 agent 的运行状态和最终结果。一条"Agent completed with response..."的纯文本消息很难让用户快速了解哪些子 agent 已完成、哪个正在运行、执行了多少工具、消耗了多少 token。用户需要一个明确、实时的子 agent 状态面板。

## Solution

在 Pi Web UI 中提供子 agent 的多层展示：悬浮状态卡片（WorkspaceStatusFloat）中显示紧凑的子 agent 摘要列表；点击可展开到右侧详情侧边栏查看完整结果和元数据。同时支持从历史记录中恢复子 agent 状态，刷新页面后依然能正确显示之前已完成的子 agent 信息。

## User Stories

1. 作为 Pi Web UI 用户，我希望在聊天区域的右上角浮窗中实时看到所有子 agent 的概要（状态、类型、描述、关键指标），这样不用中断聊天就能了解后台执行情况。

2. 作为 Pi Web UI 用户，我希望浮窗中显示每个子 agent 的紧凑指标——工具调用次数、token 总量、耗时——这样能快速判断子 agent 的进展和规模。

3. 作为 Pi Web UI 用户，当我点击浮窗中的一个已完成或出错的子 agent 行时，我希望右侧详情侧边栏打开并展示该子 agent 的完整结果，包括 Markdown 富文本回复、元数据网格和错误文本，这样能深入审查而不离开聊天。

4. 作为 Pi Web UI 用户，我希望刷新页面后，之前已完成的子 agent 状态仍能正确恢复显示，这样不会丢失对当前会话进度的认知。

5. 作为 Pi Web UI 用户，我希望正在运行或排队等待的子 agent 能显示活跃状态，已完成、失败、停止的子 agent 在未被查看前标记为待关注，这样我不会错过需要处理的反馈。

6. 作为 Pi Web UI 用户，当新的子 agent 启动时，我希望它自动出现在浮窗的最前面，这样我第一时间知道新任务已经开始。

## Implementation Decisions

### 数据来源分层

子 agent UI 状态从三个来源构建：

1. **实时事件**：Mirror Server 转发的 `subagents:*` 扩展事件
2. **Pi 事件**：`tool_execution_update` 和 `tool_execution_end` 事件中的 Agent 工具调用
3. **历史记录**：持久化的 assistant 消息中的 Agent tool call 和 toolResult，以及扩展写入的 `subagents:record`、`subagent-notification` 等条目

前台 Agent 工具调用在刷新后必须可恢复（通过 tool call + toolResult 构建）；后台和定时子 agent 仅在扩展写入持久化条目时可恢复。

### 子 agent 展示模型

Web UI 维护每个子 agent 的展示模型，包含：稳定 id（优先使用 `details.agentId`，前台 Agent 使用 tool call id 作为临时 id）、类型/显示名称、描述、状态、来源、最终回复、错误文本、结果预览、工具调用次数、耗时、token 总量、压缩次数、输出文件路径、最后更新时间。

### 状态定义

状态值：`queued`（已创建未运行）、`running`（前台活跃或正在执行的子 agent）、`background`（后台工作已接受）、`completed`（完成）、`steered`（steering 交接完成）、`aborted`（用户或宿主中断）、`stopped`（策略或调度停止）、`error`（错误）。终态（completed/steered/aborted/stopped/error）不会被后续非终态更新覆盖。

### 浮动卡片与详情侧边栏的分工

悬浮状态卡片仅显示紧凑摘要，最终回复和详细元数据在右侧详情侧边栏中展示。点击浮窗中的可点击行打开侧边栏并隐藏浮窗。详情侧边栏中的最终回复以 Markdown 富文本渲染，长内容在侧边栏体内滚动。

### 历史恢复逻辑

收到 `mirror_sync` 快照或从左侧导航栏打开已保存 session 时，重建子 agent 状态：assistant 的 Agent tool call 创建前景行（临时 id、运行中状态）；匹配的 toolResult 更新为终态信息。若结果文本以标准 "Agent completed..." 引言开头，在展示时将其移除。

### 注意力机制

运行中或排队中的 agent 视为活跃。已完成/失败/停止/中断的 agent 在被打开阅读前标记为待关注状态。已打开的 agent 若后续收到新信息，可再次请求关注。关注状态仅为 UI 状态，不修改底层结果。

## Out of Scope

- 不添加手动创建子 agent 的控制
- 不暴露原始事件 JSON 作为用户可见视图
- 不将子 agent 抽象为通用的 context-item
- 不需要 Mirror Server 合成展示状态

## Further Notes

- 悬浮卡片当前版本仅显示 Subagents，组件名保持 WorkspaceStatusFloat 以预留 Artifacts 支持
- 子 agent 的行交互规则：有最终回复或错误的行可点击；仅显示运行中的行可能不可点击
