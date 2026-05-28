# ADR 0003: Session Control via Captured Command Context

## Status

Proposed

## Context

Tau 需要支持"编辑历史用户消息并重新发送"功能，允许用户在 Web UI 中点 Edit 按钮修改一条之前的用户消息，从该点分叉出新对话分支。

实现此功能需要两个 Pi API：

1. **`navigateTree(entryId)`** — 将 session 树的 leaf 指针回退到指定条目
2. **`sendUserMessage(text)`** — 从新的 leaf 位置发送消息

`sendUserMessage` 在任何上下文都可以调用，但 `navigateTree` 和其他 session 控制方法（`fork`、`newSession`、`switchSession`）**仅存在于 `ExtensionCommandContext`** 上，不在 `ExtensionContext` 上。

Tau 的核心事件处理（WebSocket handler）运行在 `ExtensionContext` 中，因此无法直接调用 `navigateTree`。

Pi 的作者明确表示这是**刻意设计**——session 控制方法被限定在命令 handler 中，不接受从事件 handler 调用的方案（见 GitHub issues #3673、#4754）。同时 `pi.sendUserMessage("/cmd")` 刻意把 `expandPromptTemplates` 设为 `false`，使得无法通过发送斜杠命令文本来触发注册的命令。

## Decision

我们将在 `/tau` 命令的 handler（运行在 `ExtensionCommandContext` 中）执行时**捕获 `navigateTree` 闭包**，存储为模块级变量，供 WebSocket handler 后续使用。

```
用户运行 /tau
  → ExtensionCommandContext 创建
    → latestNavigateTree = (entryId) => ctx.navigateTree(entryId)
    → 闭包委托给 runner.navigateTreeHandler，只要 runner 不被 dispose 就有效
```

WebSocket handler 中新增 `navigate_tree` 命令类型，检查 `latestNavigateTree` 有效性后调用。

## Consequences

### 正向

- 不修改 Pi 源码
- 不注册额外的公开斜杠命令（复用现有的 `/tau`）
- 命令对齐 Pi API：`navigate_tree` → `navigateTree`，`prompt` → `sendUserMessage`
- 两步操作让前端拥有编排权（navigate 成功后前端再发 prompt）

### 负向

- `/tau` 必须被执行过一次，`navigateTree` 才可用。在 `session_start`（fork/new/resume 等 session 替换后）需要清空，用户需重新运行 `/tau`
- 捕获的闭包依赖 extension runner 不被 dispose。`session_start` 时清空 `latestNavigateTree` 可防止调用已失效的 runner
- 是 workaround 而非 Pi 原生 API——如果 Pi 未来把 `navigateTree` 加到 `ExtensionContext`，应迁移到原生方案

### 中性

- 需要 `advancedFeatures` 标志告知前端 Edit 功能是否可用
- Web UI 中 `/tau` 的文案从"Open browser"扩展为"Connect web UI for advanced features"

## Alternatives Considered

| 方案 | 判定 |
|------|------|
| 注册新命令 `/tau-edit`，用 `sendUserMessage` 触发 | ❌ `sendUserMessage` 设置 `expandPromptTemplates: false`，命令不会被识别 |
| 类型强转 `ctx` 为 `ExtensionCommandContext` | ❌ 运行时对象上确实没有 `navigateTree` 方法 |
| 修改 Pi 源码给 `ExtensionContext` 加 `navigateTree` | ❌ Pi 作者明确拒绝此方向 |
| 直接操作 `(ctx.sessionManager as any).branch()` | ❌ 仅移动 leaf 指针，不更新 agent state，不能正常工作 |

## References

- Pi Extension API: `ExtensionContext` vs `ExtensionCommandContext` (`extensions/types.ts`)
- GitHub #3673: `feat(extensions): expose session control methods` — rejected by author
- GitHub #4754: `pi.sendUserMessage("/cmd")` does not execute slash commands — "that's by design"
- Tau `mirror-server.ts`: two `session_start` handlers (auto-title at ~line 585, auto-start at ~line 2042). Clearing logic should go in the auto-title handler since it already manages session-level state.
- Pi `navigateTree`: `agent-session.ts:2651-2848`, returns `{ cancelled, editorText?, aborted?, summaryEntry? }`
- Pi `ReadonlySessionManager.getBranch()`: `session-manager.ts:194`, returns root-to-leaf order
- Pi Extension Runner: `createCommandContext()` binds `navigateTreeHandler` at runner.ts:448
