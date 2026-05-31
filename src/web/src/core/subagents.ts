import type { RpcEvent, SessionEntry, SubagentStatus, SubagentTokens, SubagentViewState } from "./types";

export type SubagentStateMap = Record<string, SubagentViewState>;

type SubagentPatch = Partial<Omit<SubagentViewState, "id">> & { id: string };

const TERMINAL_STATUSES = new Set<SubagentStatus>(["completed", "steered", "aborted", "stopped", "error"]);

export function applySubagentEvent(current: SubagentStateMap, event: RpcEvent): SubagentStateMap {
  const patches = [patchFromSubagentEvent(event), patchFromAgentToolEvent(event)].filter(Boolean) as SubagentPatch[];

  if (patches.length === 0) return current;
  let next = current;
  for (const patch of patches) {
    next = upsertSubagent(next, patch);
  }
  return next;
}

export function subagentsFromEntries(entries: SessionEntry[] = []): SubagentStateMap {
  let state: SubagentStateMap = {};
  const foregroundCalls = new Map<string, SubagentPatch>();
  const foregroundResults: Array<{ patch: SubagentPatch; toolCallId: string }> = [];

  for (const entry of entries) {
    for (const patch of patchesFromEntry(entry)) {
      state = upsertSubagent(state, {
        ...patch,
        source: patch.source || "history",
      });
    }
    for (const patch of foregroundCallPatchesFromEntry(entry)) {
      foregroundCalls.set(patch.id, patch);
    }
    const foregroundResult = foregroundResultPatchFromEntry(entry, foregroundCalls);
    if (foregroundResult) foregroundResults.push(foregroundResult);
  }

  const resolvedToolCallIds = new Set(foregroundResults.map((result) => result.toolCallId));
  for (const [toolCallId, patch] of foregroundCalls) {
    if (!resolvedToolCallIds.has(toolCallId)) {
      state = upsertSubagent(state, patch);
    }
  }
  for (const { patch } of foregroundResults) {
    state = upsertSubagent(state, patch);
  }
  return state;
}

export function subagentList(state: SubagentStateMap): SubagentViewState[] {
  return Object.values(state).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isSubagentTerminal(agent: SubagentViewState): boolean {
  return TERMINAL_STATUSES.has(agent.status);
}

export function canOpenSubagentDetail(agent: SubagentViewState): boolean {
  return Boolean(agent.finalResponse || agent.error);
}

export function subagentStatusLabel(status: SubagentStatus): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "background":
      return "background";
    case "completed":
      return "done";
    case "steered":
      return "wrapped";
    case "aborted":
      return "aborted";
    case "stopped":
      return "stopped";
    case "error":
      return "failed";
  }
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function patchFromSubagentEvent(event: RpcEvent): SubagentPatch | null {
  if (!event.type.startsWith("subagents:")) return null;
  const payload = asRecord(event.payload);

  switch (event.type) {
    case "subagents:created": {
      const id = asString(payload.id);
      if (!id) return null;
      return {
        id,
        type: asString(payload.type),
        description: asString(payload.description),
        status: "queued",
        isBackground: Boolean(payload.isBackground),
        source: "background",
      };
    }
    case "subagents:started": {
      const id = asString(payload.id);
      if (!id) return null;
      return {
        id,
        type: asString(payload.type),
        description: asString(payload.description),
        status: "running",
        source: "event",
      };
    }
    case "subagents:completed":
    case "subagents:failed": {
      const id = asString(payload.id);
      if (!id) return null;
      const status =
        normalizeStatus(asString(payload.status)) || (event.type === "subagents:completed" ? "completed" : "error");
      return {
        id,
        type: asString(payload.type),
        description: asString(payload.description),
        status,
        finalResponse: asString(payload.result),
        error: asString(payload.error),
        toolUses: asNumber(payload.toolUses),
        durationMs: asNumber(payload.durationMs),
        tokens: asTokens(payload.tokens),
        source: "background",
      };
    }
    case "subagents:compacted": {
      const id = asString(payload.id);
      if (!id) return null;
      return {
        id,
        type: asString(payload.type),
        description: asString(payload.description),
        compactionCount: asNumber(payload.compactionCount),
      };
    }
    case "subagents:scheduled": {
      if (payload.type !== "fired") return null;
      const id = asString(payload.agentId);
      if (!id) return null;
      return {
        id,
        description: asString(payload.name),
        status: "running",
        isBackground: true,
        source: "scheduled",
      };
    }
    default:
      return null;
  }
}

function patchFromAgentToolEvent(event: RpcEvent): SubagentPatch | null {
  if (!isAgentToolEvent(event)) return null;
  const details = extractAgentDetails(event.type === "tool_execution_update" ? event.partialResult : event.result);
  if (!details) return null;
  const id = asString(details.agentId);
  if (!id) return null;

  const status = normalizeStatus(asString(details.status));
  const finalResponse =
    status && status !== "background" && status !== "running"
      ? extractFinalAgentResponse(event.result, status)
      : undefined;

  return {
    id,
    type: asString(details.subagentType),
    description: asString(details.description),
    status: status || "running",
    finalResponse,
    error: asString(details.error) || (status === "error" ? finalResponse : undefined),
    toolUses: asNumber(details.toolUses),
    durationMs: asNumber(details.durationMs),
    source: status === "background" ? "background" : "foreground",
  };
}

function patchesFromEntry(entry: SessionEntry): SubagentPatch[] {
  const customType = asString(entry.customType) || asString(entry.message?.customType);
  if (customType === "subagents:record" || entry.type === "subagents:record") {
    const record = asRecord(entry.data ?? entry.payload ?? entry.value ?? entry.details ?? entry);
    const id = asString(record.id);
    if (!id) return [];
    return [
      {
        id,
        type: asString(record.type),
        description: asString(record.description),
        status: normalizeStatus(asString(record.status)) || "completed",
        finalResponse: asString(record.result),
        error: asString(record.error),
        updatedAt: asNumber(record.completedAt) || asNumber(record.startedAt) || Date.now(),
      },
    ];
  }

  if (customType === "subagent-notification" || entry.type === "custom_message") {
    const details = asRecord(entry.message?.details ?? entry.details);
    return notificationPatches(details);
  }

  return [];
}

function foregroundCallPatchesFromEntry(entry: SessionEntry): SubagentPatch[] {
  if (entry.type !== "message" || entry.message?.role !== "assistant") return [];
  return agentToolCallsFromContent(entry.message.content).flatMap((call) => {
    const id = asString(call.id);
    if (!id) return [];
    const args = asRecord(call.arguments);
    return [
      {
        id,
        type: asString(args.subagent_type) || asString(args.subagentType),
        description: asString(args.description),
        status: "running" as const,
        source: "foreground" as const,
        updatedAt: timestampFromEntry(entry) || Date.now(),
      },
    ];
  });
}

function foregroundResultPatchFromEntry(
  entry: SessionEntry,
  foregroundCalls: Map<string, SubagentPatch>,
): { patch: SubagentPatch; toolCallId: string } | null {
  const message = entry.message;
  const toolCallId = asString(message?.toolCallId);
  if (entry.type !== "message" || message?.role !== "toolResult" || message.toolName !== "Agent" || !toolCallId) {
    return null;
  }

  const details = extractAgentDetails(message) || {};
  const callPatch = foregroundCalls.get(toolCallId);
  const status = normalizeStatus(asString(details.status)) || (message.isError ? "error" : "completed");
  const finalResponse =
    status !== "background" && status !== "running" ? extractFinalAgentResponse(message.content, status) : undefined;
  const agentId = asString(details.agentId) || toolCallId;

  return {
    toolCallId,
    patch: {
      id: agentId,
      type: asString(details.subagentType) || callPatch?.type,
      description: asString(details.description) || callPatch?.description,
      status,
      finalResponse,
      error: asString(details.error) || (message.isError || status === "error" ? finalResponse : undefined),
      toolUses: asNumber(details.toolUses),
      durationMs: asNumber(details.durationMs),
      source: status === "background" ? "background" : "foreground",
      updatedAt: timestampFromEntry(entry) || Date.now(),
    },
  };
}

function notificationPatches(details: Record<string, unknown>): SubagentPatch[] {
  if (!Object.keys(details).length) return [];
  const all = [details, ...asArray(details.others).map(asRecord)];
  return all.flatMap((detail) => {
    const id = asString(detail.id);
    if (!id) return [];
    return [
      {
        id,
        description: asString(detail.description),
        status: normalizeStatus(asString(detail.status)) || "completed",
        resultPreview: asString(detail.resultPreview),
        error: asString(detail.error),
        toolUses: asNumber(detail.toolUses),
        durationMs: asNumber(detail.durationMs),
        tokens: tokensFromTotal(asNumber(detail.totalTokens)),
        outputFile: asString(detail.outputFile),
        source: "background" as const,
      },
    ];
  });
}

function upsertSubagent(state: SubagentStateMap, patch: SubagentPatch): SubagentStateMap {
  const existing = state[patch.id];
  const nextStatus = mergeStatus(existing?.status, patch.status);
  const updatedAt = patch.updatedAt || Date.now();
  const merged = { ...existing, ...patch };
  const nextAgent: SubagentViewState = {
    ...merged,
    id: patch.id,
    status: nextStatus || patch.status || existing?.status || "running",
    updatedAt: Math.max(existing?.updatedAt || 0, updatedAt),
    finalResponse: patch.finalResponse || existing?.finalResponse,
    resultPreview: patch.resultPreview || existing?.resultPreview,
    error: patch.error || existing?.error,
    tokens: patch.tokens || existing?.tokens,
    outputFile: patch.outputFile || existing?.outputFile,
  };
  return {
    ...state,
    [patch.id]: nextAgent,
  };
}

function mergeStatus(
  current: SubagentStatus | undefined,
  next: SubagentStatus | undefined,
): SubagentStatus | undefined {
  if (!next) return current;
  if (!current) return next;
  if (TERMINAL_STATUSES.has(current) && !TERMINAL_STATUSES.has(next)) return current;
  if (current === "running" && (next === "queued" || next === "background")) return current;
  return next;
}

function isAgentToolEvent(event: RpcEvent): boolean {
  return (event.type === "tool_execution_update" || event.type === "tool_execution_end") && event.toolName === "Agent";
}

function extractAgentDetails(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  const details = asRecord(record.details);
  return Object.keys(details).length > 0 ? details : null;
}

function extractFinalAgentResponse(value: unknown, status: SubagentStatus): string | undefined {
  const text = extractContentText(value).trim();
  if (!text) return undefined;
  if (status === "completed" || status === "steered") {
    const parts = text.split(/\n{2,}/);
    if (/^Agent completed\b/.test(parts[0] || "")) {
      return parts.slice(1).join("\n\n").trim() || text;
    }
  }
  return text;
}

function extractContentText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const content = Array.isArray(value) ? value : asArray(record.content);
  if (content.length === 0) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const block = asRecord(part);
      return asString(block.text);
    })
    .filter(Boolean)
    .join("\n");
}

function agentToolCallsFromContent(content: unknown): Array<Record<string, unknown>> {
  return asArray(content)
    .map(asRecord)
    .filter((block) => block.type === "toolCall" && block.name === "Agent");
}

function timestampFromEntry(entry: SessionEntry): number | undefined {
  return timestampFromValue(entry.timestamp) || timestampFromValue(asRecord(entry.message).timestamp);
}

function timestampFromValue(value: unknown): number | undefined {
  const numeric = asNumber(value);
  if (numeric) return numeric;
  const text = asString(value);
  if (!text) return undefined;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeStatus(value?: string): SubagentStatus | undefined {
  if (!value) return undefined;
  if (value === "failed") return "error";
  if (value === "done") return "completed";
  if (
    value === "queued" ||
    value === "running" ||
    value === "background" ||
    value === "completed" ||
    value === "steered" ||
    value === "aborted" ||
    value === "stopped" ||
    value === "error"
  ) {
    return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asTokens(value: unknown): SubagentTokens | undefined {
  const record = asRecord(value);
  const tokens = {
    input: asNumber(record.input),
    output: asNumber(record.output),
    total: asNumber(record.total),
  };
  return tokens.input || tokens.output || tokens.total ? tokens : undefined;
}

function tokensFromTotal(total?: number): SubagentTokens | undefined {
  return total ? { total } : undefined;
}
