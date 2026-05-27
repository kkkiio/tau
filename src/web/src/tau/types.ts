import type { ChatStatus } from "ai";
import type { ComponentType } from "react";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export type ThemeMode = "system" | "light" | "dark";
export type AppView = "chat" | "projects";
export type SystemTone = "info" | "success" | "error";
export type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error";

export type SubagentStatus =
  | "queued"
  | "running"
  | "background"
  | "completed"
  | "steered"
  | "aborted"
  | "stopped"
  | "error";

export type PromptImage = {
  data: string;
  mimeType: string;
};

export type PromptCommand = {
  id: string;
  message: string;
  images?: PromptImage[];
};

export type ChatItem =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant";
      text: string;
      reasoning?: string;
      streaming?: boolean;
      copyable?: boolean;
      presentation?: "normal" | "activity";
      cost?: number;
      images?: PromptImage[];
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      output?: unknown;
      errorText?: string;
      state: ToolState;
      open?: boolean;
    }
  | {
      kind: "system";
      id: string;
      text: string;
      tone?: SystemTone;
    };

export type RpcEvent = {
  type: string;
  payload?: unknown;
  message?: PiMessage;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
  };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  name?: string;
  summary?: string;
  error?: string;
  method?: ExtensionDialog["method"];
  id?: string;
  title?: string;
  options?: string[];
  timeout?: number;
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
  enabled?: boolean;
  model?: ModelInfo;
};

export type PiMessage = {
  id?: string;
  role: "user" | "assistant" | "toolResult" | string;
  content?: string | PiContentBlock[];
  customType?: string;
  details?: unknown;
  usage?: Usage;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type PiContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string }
  | { type: "toolCall"; id?: string; name?: string; arguments?: unknown }
  | {
      type: "image";
      data?: string;
      mimeType?: string;
      source?: { data?: string; media_type?: string };
    }
  | Record<string, unknown>;

export type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
};

export type ModelInfo = {
  id: string;
  provider?: string;
  contextWindow?: number;
};

export type MirrorSync = {
  entries?: SessionEntry[];
  model?: ModelInfo;
  thinkingLevel?: string;
  sessionName?: string;
  sessionFile?: string;
  isStreaming?: boolean;
  contextUsage?: { tokens?: number };
};

export type SessionEntry = {
  type: string;
  customType?: string;
  message?: PiMessage;
  details?: unknown;
  data?: unknown;
  value?: unknown;
  payload?: unknown;
  id?: string;
  [key: string]: unknown;
};

export type SubagentTokens = {
  input?: number;
  output?: number;
  total?: number;
};

export type SubagentViewState = {
  id: string;
  type?: string;
  description?: string;
  status: SubagentStatus;
  finalResponse?: string;
  resultPreview?: string;
  error?: string;
  toolUses?: number;
  durationMs?: number;
  tokens?: SubagentTokens;
  outputFile?: string;
  compactionCount?: number;
  isBackground?: boolean;
  source?: "foreground" | "background" | "scheduled" | "history" | "event";
  updatedAt: number;
};

export type ProjectGroup = {
  dirName: string;
  path: string;
  sessions: SessionInfo[];
};

export type SessionInfo = {
  filePath: string;
  file?: string;
  name?: string;
  firstMessage?: string;
  timestamp?: string;
  tmux?: boolean;
};

export type SearchResult = {
  filePath: string;
  project?: string;
  sessionName?: string;
  firstMessage?: string;
  sessionTimestamp?: string;
  matches?: Array<{ snippet?: string }>;
};

export type RunningInstance = {
  port: number;
  sessionFile: string;
  cwd: string;
};

export type LaunchProject = {
  name: string;
  path: string;
  active?: boolean;
  sessionCount?: number;
  lastActive?: number;
};

export type ExtensionDialog = {
  id: string;
  method: "select" | "confirm" | "input" | "editor" | "notify";
  title?: string;
  message?: string;
  options?: string[];
  timeout?: number;
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
};

export type CommandAction = {
  label: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  action: () => void;
};

export type ChatSubmitStatus = ChatStatus;
