import {
  ArchiveIcon,
  BarChart3Icon,
  BotIcon,
  BrainIcon,
  ChevronsUpDownIcon,
  CommandIcon,
  DownloadIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ChatItemView,
  CommandPalette,
  ConnectionDot,
  ContextPopover,
  ExtensionDialogView,
  ModelPicker,
  ProjectLauncher,
  PromptAttachmentButton,
  PromptAttachmentPreview,
  SessionSidebar,
  SettingsPanel,
  SubagentDetailSidebar,
  UserMessageView,
  WorkspaceStatusFloat,
} from "./components/tau";
import {
  extractText,
  extractThinking,
  extractToolCalls,
  findLastUsage,
  formatToolOutput,
  processPromptFiles,
  syncToItems,
} from "./tau/chat-conversion";
import { copyText, formatTokens, isEditableTarget, shortModelName, toggleSetValue } from "./tau/format";
import { applySubagentEvent, type SubagentStateMap, subagentList, subagentsFromEntries } from "./tau/subagents";
import { isToolExpandable } from "./tau/tool-summary";
import type {
  AppView,
  ChatItem,
  ChatSubmitStatus,
  ConnectionState,
  ExtensionDialog,
  LaunchProject,
  MirrorSync,
  ModelInfo,
  ProjectGroup,
  PromptCommand,
  RpcEvent,
  RunningInstance,
  SearchResult,
  SessionInfo,
  SystemTone,
  ThemeMode,
  Usage,
} from "./tau/types";
import { wsUrl } from "./tau/ws";

export function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [chatStatus, setChatStatus] = useState<ChatSubmitStatus>("ready");
  const [modelLabel, setModelLabel] = useState("model");
  const [currentModel, setCurrentModel] = useState<ModelInfo | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState("off");
  const [sessionName, setSessionName] = useState("Tau");
  const [error, setError] = useState<string | null>(null);
  const [tailscaleUrl, setTailscaleUrl] = useState("");
  const [advancedFeatures, setAdvancedFeatures] = useState(false);

  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => (localStorage.getItem("tau-theme-mode") as ThemeMode | null) || "system",
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 900);
  const [view, setView] = useState<AppView>("chat");
  const [projects, setProjects] = useState<ProjectGroup[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [favourites, setFavourites] = useState<string[]>(
    () => JSON.parse(localStorage.getItem("tau-favourites") || "[]") as string[],
  );
  const [activeSessionFile, setActiveSessionFile] = useState<string | null>(null);
  const [liveSessionFile, setLiveSessionFile] = useState<string | null>(null);
  const [viewingActiveSession, setViewingActiveSession] = useState(true);
  const [liveInstances, setLiveInstances] = useState<RunningInstance[]>([]);

  const [launcherProjects, setLauncherProjects] = useState<LaunchProject[]>([]);
  const [launcherLoading, setLauncherLoading] = useState(false);

  const [queuedMessages, setQueuedMessages] = useState<PromptCommand[]>([]);

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [showThinking, setShowThinking] = useState(() => localStorage.getItem("tau-show-thinking") !== "false");
  const [autoCompaction, setAutoCompaction] = useState(true);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [dialog, setDialog] = useState<ExtensionDialog | null>(null);
  const [subagents, setSubagents] = useState<SubagentStateMap>({});
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);

  const [lastUsage, setLastUsage] = useState<Usage | null>(null);
  const [contextWindowSize, setContextWindowSize] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const streamingHasToolCallRef = useRef(false);
  const lastSentRef = useRef<string | null>(null);
  const itemCounterRef = useRef(0);
  const unreadCountRef = useRef(0);
  const originalTitleRef = useRef(document.title);

  const resolvedTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

  const nextId = useCallback((prefix: string) => {
    itemCounterRef.current += 1;
    return `${prefix}-${Date.now()}-${itemCounterRef.current}`;
  }, []);

  const addSystemMessage = useCallback(
    (text: string, tone: SystemTone = "info") => {
      setItems((current) => [...current, { kind: "system", id: nextId("system"), text, tone }]);
    },
    [nextId],
  );

  const sendWs = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  const rpc = useCallback(async (cmd: Record<string, unknown>) => {
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "RPC failed");
    }
    return result;
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const response = await fetch("/api/sessions");
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadInstances = useCallback(async () => {
    try {
      const response = await fetch("/api/instances");
      if (!response.ok) return;
      const data = await response.json();
      setLiveInstances(data.instances || []);
    } catch {
      // Best effort only.
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setLauncherLoading(true);
    try {
      const response = await fetch("/api/projects");
      const data = await response.json();
      setLauncherProjects(data.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLauncherLoading(false);
    }
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const [stateResult, modelsResult] = await Promise.allSettled([
        rpc({ type: "get_state" }),
        rpc({ type: "get_available_models" }),
      ]);

      if (modelsResult.status === "fulfilled") {
        setAvailableModels(modelsResult.value.data?.models || []);
      }

      if (stateResult.status === "fulfilled") {
        const data = stateResult.value.data || {};
        setCurrentModel(data.model || null);
        setModelLabel(shortModelName(data.model?.id || "model"));
        setThinkingLevel(data.thinkingLevel || "off");
        setSessionName(data.sessionName || "Tau");
        setAutoCompaction(Boolean(data.autoCompactionEnabled));
        if (data.model?.contextWindow) setContextWindowSize(data.model.contextWindow);
      }
    } catch (err) {
      console.error("[Tau] get_state failed", err);
    }
  }, [rpc]);

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      setTailscaleUrl(data.tailscaleUrl || "");
    } catch {
      // Health only decorates the status label.
    }
  }, []);

  const applySync = useCallback(
    (sync: MirrorSync) => {
      const parsedItems = syncToItems(sync.entries ?? [], nextId);
      const nextSubagents = subagentsFromEntries(sync.entries ?? []);
      setItems(parsedItems);
      setSubagents(nextSubagents);
      setSelectedSubagentId((current) => (current && nextSubagents[current] ? current : null));
      setChatStatus(sync.isStreaming ? "streaming" : "ready");
      setConnection("connected");
      setSessionName(sync.sessionName || "Tau");
      setCurrentModel(sync.model || null);
      setModelLabel(shortModelName(sync.model?.id || "model"));
      setThinkingLevel(sync.thinkingLevel || "off");
      setLiveSessionFile(sync.sessionFile || null);
      setActiveSessionFile(sync.sessionFile || null);
      setViewingActiveSession(true);
      setLastUsage(findLastUsage(sync.entries ?? []));
      if (sync.model?.contextWindow) setContextWindowSize(sync.model.contextWindow);
      setError(null);
    },
    [nextId],
  );

  const handleEvent = useCallback(
    (event: RpcEvent) => {
      setSubagents((current) => applySubagentEvent(current, event));

      switch (event.type) {
        case "agent_start":
          setChatStatus("streaming");
          break;

        case "agent_end": {
          const hadToolCall = streamingHasToolCallRef.current;
          const streamingCopyable = !hadToolCall;
          setChatStatus("ready");
          streamingIdRef.current = null;
          streamingHasToolCallRef.current = false;
          setItems((current) =>
            current.map((item) =>
              item.kind === "message" && item.streaming
                ? {
                    ...item,
                    streaming: false,
                    copyable: streamingCopyable,
                    presentation: hadToolCall ? "activity" : "normal",
                  }
                : item,
            ),
          );
          if (document.hidden) {
            unreadCountRef.current += 1;
            document.title = `(${unreadCountRef.current}) ${originalTitleRef.current}`;
          }
          break;
        }

        case "message_start":
          if (event.message?.role === "assistant") {
            const id = event.message.id || nextId("assistant");
            const hasInitialToolCall = extractToolCalls(event.message.content).length > 0;
            streamingIdRef.current = id;
            streamingHasToolCallRef.current = hasInitialToolCall;
            setItems((current) => [
              ...current,
              {
                kind: "message",
                id,
                role: "assistant",
                text: extractText(event.message?.content),
                reasoning: extractThinking(event.message?.content),
                streaming: true,
                copyable: false,
                presentation: hasInitialToolCall ? "activity" : "normal",
              },
            ]);
          } else if (event.message?.role === "user") {
            const text = extractText(event.message.content);
            if (!text) break;
            if (lastSentRef.current === text) {
              lastSentRef.current = null;
              break;
            }
            setItems((current) => [
              ...current,
              {
                kind: "message",
                id: event.message?.id || nextId("user"),
                role: "user",
                text,
              },
            ]);
          }
          break;

        case "message_update": {
          const messageEvent = event.assistantMessageEvent;
          const delta = messageEvent?.delta || "";
          const id = streamingIdRef.current;
          if (!id) break;
          if (messageEvent?.type === "toolcall_delta") {
            streamingHasToolCallRef.current = true;
            setItems((current) =>
              current.map((item) =>
                item.kind === "message" && item.id === id
                  ? { ...item, copyable: false, presentation: "activity" }
                  : item,
              ),
            );
            break;
          }
          if (!delta) break;
          if (messageEvent?.type !== "text_delta" && messageEvent?.type !== "thinking_delta") break;

          setItems((current) =>
            current.map((item) => {
              if (item.kind !== "message" || item.id !== id) return item;
              if (messageEvent.type === "thinking_delta") {
                return {
                  ...item,
                  reasoning: `${item.reasoning || ""}${delta}`,
                };
              }
              return { ...item, text: `${item.text}${delta}` };
            }),
          );
          break;
        }

        case "message_end": {
          const id = streamingIdRef.current;
          if (!id) break;
          const usage = event.message?.usage;
          const finalText = event.message ? extractText(event.message.content) : undefined;
          const finalReasoning = event.message ? extractThinking(event.message.content) : undefined;
          const finalToolCalls = event.message ? extractToolCalls(event.message.content) : undefined;
          const hasToolCalls = finalToolCalls?.length ? true : streamingHasToolCallRef.current;
          setLastUsage(usage || null);
          setItems((current) =>
            current.map((item) =>
              item.kind === "message" && item.id === id
                ? {
                    ...item,
                    streaming: false,
                    cost: usage?.cost?.total,
                    ...(finalText !== undefined && { text: finalText }),
                    ...(finalReasoning !== undefined && {
                      reasoning: finalReasoning,
                    }),
                    copyable: !hasToolCalls,
                    presentation: hasToolCalls ? "activity" : "normal",
                  }
                : item,
            ),
          );
          streamingIdRef.current = null;
          streamingHasToolCallRef.current = false;
          break;
        }

        case "tool_execution_start":
          if (!event.toolCallId) break;
          streamingHasToolCallRef.current = true;
          setItems((current) => [
            ...current,
            {
              kind: "tool",
              id: event.toolCallId as string,
              name: event.toolName || "tool",
              input: event.args,
              state: "input-streaming",
              open: false,
            },
          ]);
          break;

        case "tool_execution_update":
          if (!event.toolCallId) break;
          setItems((current) =>
            current.map((item) =>
              item.kind === "tool" && item.id === event.toolCallId
                ? {
                    ...item,
                    output: formatToolOutput(event.partialResult),
                    state: "input-available",
                  }
                : item,
            ),
          );
          break;

        case "tool_execution_end":
          if (!event.toolCallId) break;
          setItems((current) =>
            current.map((item) =>
              item.kind === "tool" && item.id === event.toolCallId
                ? {
                    ...item,
                    output: event.isError ? undefined : formatToolOutput(event.result),
                    errorText: event.isError ? String(formatToolOutput(event.result)) : undefined,
                    state: event.isError ? "output-error" : "output-available",
                  }
                : item,
            ),
          );
          break;

        case "auto_compaction_start":
          addSystemMessage("Compacting context...");
          break;

        case "auto_compaction_end":
          addSystemMessage(`Context compacted${event.summary ? `: ${event.summary}` : ""}`, "success");
          setLastUsage(null);
          setContextOpen(false);
          break;

        case "extension_ui_request":
          if (event.id && event.method) {
            setDialog({
              id: event.id,
              method: event.method,
              title: event.title,
              message: event.message as string | undefined,
              options: event.options,
              timeout: event.timeout,
              placeholder: event.placeholder,
              prefill: event.prefill,
            });
          }
          break;

        case "extension_error":
          addSystemMessage(`Extension error: ${event.error || "Unknown error"}`, "error");
          break;

        case "session_name":
          if (event.name) setSessionName(event.name);
          break;

        case "auth_changed":
          setAuthEnabled(Boolean(event.enabled));
          break;

        case "model_select":
          if (event.model) {
            setCurrentModel(event.model);
            setModelLabel(shortModelName(event.model.id));
            if (event.model.contextWindow) setContextWindowSize(event.model.contextWindow);
          }
          break;

        default:
          break;
      }
    },
    [addSystemMessage, nextId],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    localStorage.setItem("tau-theme-mode", themeMode);
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, themeMode]);

  useEffect(() => {
    localStorage.setItem("tau-show-thinking", String(showThinking));
  }, [showThinking]);

  useEffect(() => {
    localStorage.setItem("tau-favourites", JSON.stringify(favourites));
  }, [favourites]);

  useEffect(() => {
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadInstances();
    refreshState();
    fetchHealth();
    const interval = window.setInterval(() => {
      loadInstances();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [fetchHealth, loadInstances, loadSessions, refreshState]);

  useEffect(() => {
    if (view === "projects") loadProjects();
  }, [loadProjects, view]);

  useEffect(() => {
    if (sessionQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(sessionQuery.trim())}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        setSearchResults(data.results || []);
      } catch (err) {
        if (!controller.signal.aborted) console.error("[Tau] search failed", err);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [sessionQuery]);

  useEffect(() => {
    let intentionallyClosed = false;

    const connect = () => {
      setConnection("connecting");
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnection("connected");
        setError(null);
        fetchHealth();
      };

      ws.onmessage = (messageEvent) => {
        try {
          const data = JSON.parse(messageEvent.data) as {
            type?: string;
            [key: string]: unknown;
          };
          if (data.type === "mirror_sync") {
            applySync(data as MirrorSync);
          } else if (data.type === "event") {
            handleEvent(data.event as RpcEvent);
          } else if (data.type === "error") {
            setError(String(data.message || "Server error"));
          } else if (data.type === "state") {
            const s = data as { advancedFeatures?: boolean };
            if (typeof s.advancedFeatures === "boolean") {
              setAdvancedFeatures(s.advancedFeatures);
            }
          } else if (data.type !== "response") {
            handleEvent(data as unknown as RpcEvent);
          }
        } catch (err) {
          console.error("[Tau] Failed to parse WebSocket message", err);
        }
      };

      ws.onerror = () => setError("WebSocket error");

      ws.onclose = () => {
        setConnection("disconnected");
        wsRef.current = null;
        if (!intentionallyClosed) {
          reconnectTimerRef.current = window.setTimeout(connect, 1200);
        }
      };
    };

    connect();

    return () => {
      intentionallyClosed = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [applySync, fetchHealth, handleEvent]);

  useEffect(() => {
    const onFocus = () => {
      unreadCountRef.current = 0;
      document.title = originalTitleRef.current;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState !== WebSocket.OPEN) {
        wsRef.current?.close();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const sendPrompt = useCallback(
    async (command: PromptCommand, optimistic = true) => {
      if (!viewingActiveSession) {
        setError("Viewing historical session. Switch back to the live session to send messages.");
        return;
      }

      lastSentRef.current = command.message;
      if (optimistic) {
        setItems((current) => [
          ...current,
          {
            kind: "message",
            id: nextId("user"),
            role: "user",
            text: command.message,
            images: command.images,
          },
        ]);
      }
      setChatStatus("submitted");
      setError(null);

      try {
        const payload = {
          type: "prompt",
          message: command.message,
          images: command.images,
        };
        if (!sendWs(payload)) {
          await rpc(payload);
        }
      } catch (err) {
        setChatStatus("error");
        setError(err instanceof Error ? err.message : "Prompt failed");
      }
    },
    [nextId, rpc, sendWs, viewingActiveSession],
  );

  useEffect(() => {
    if (chatStatus !== "ready" || queuedMessages.length === 0 || !viewingActiveSession) return;
    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    sendPrompt(next);
  }, [chatStatus, queuedMessages, sendPrompt, viewingActiveSession]);

  const handleEditSubmit = useCallback(
    async (entryId: string, newText: string) => {
      // Step 1: navigate tree
      const navResult = await rpc({ type: "navigate_tree", entryId });
      if (!navResult.success) {
        throw new Error(navResult.error || "Navigation failed");
      }
      // Step 2: send edited prompt
      await rpc({ type: "prompt", message: newText });
    },
    [rpc],
  );

  const submitMessage = useCallback(
    async ({ text, files }: { text: string; files?: unknown[] }) => {
      const trimmed = text.trim();
      const images = await processPromptFiles(files);
      if (!trimmed && images.length === 0) return;

      const command: PromptCommand = {
        id: nextId("prompt"),
        message: trimmed || "(see attached image)",
        images: images.length ? images : undefined,
      };

      if (chatStatus === "streaming" || chatStatus === "submitted") {
        setQueuedMessages((current) => [...current, command]);
        return;
      }

      await sendPrompt(command);
    },
    [chatStatus, nextId, sendPrompt],
  );

  const abort = useCallback(async () => {
    try {
      if (!sendWs({ type: "abort" })) {
        await rpc({ type: "abort" });
      }
      setChatStatus("ready");
      addSystemMessage("Aborted by user", "error");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Abort failed");
    }
  }, [addSystemMessage, rpc, sendWs]);

  const cycleThinking = useCallback(async () => {
    try {
      const result = await rpc({ type: "cycle_thinking_level" });
      setThinkingLevel(result.data?.level || result.data?.thinkingLevel || "off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change thinking level");
    }
  }, [rpc]);

  const openModelPicker = useCallback(async () => {
    setModelOpen(true);
    await refreshState();
  }, [refreshState]);

  const selectModel = useCallback(
    async (model: ModelInfo) => {
      try {
        await rpc({
          type: "set_model",
          provider: model.provider,
          modelId: model.id,
        });
        setCurrentModel(model);
        setModelLabel(shortModelName(model.id));
        if (model.contextWindow) setContextWindowSize(model.contextWindow);
        setModelOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to switch model");
      }
    },
    [rpc],
  );

  const selectSession = useCallback(
    async (session: SessionInfo, project?: ProjectGroup) => {
      setActiveSessionFile(session.filePath);
      setError(null);

      const otherInstance = liveInstances.find(
        (instance) => instance.sessionFile === session.filePath && instance.port !== Number(location.port || 3001),
      );
      if (otherInstance) {
        window.location.href = `${location.protocol}//${location.hostname}:${otherInstance.port}${location.pathname}${location.search}${location.hash}`;
        return;
      }

      if (session.filePath === liveSessionFile) {
        setViewingActiveSession(true);
        sendWs({ type: "mirror_sync_request" });
        return;
      }

      setViewingActiveSession(false);
      setChatStatus("ready");
      const dirName = project?.dirName;
      const file = session.file;
      if (!dirName || !file) return;

      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(dirName)}/${encodeURIComponent(file)}`);
        const data = await response.json();
        const entries = data.entries || [];
        const nextSubagents = subagentsFromEntries(entries);
        setItems(syncToItems(entries, nextId));
        setSubagents(nextSubagents);
        setSelectedSubagentId((current) => (current && nextSubagents[current] ? current : null));
        setSessionName(session.name || session.firstMessage || "Session history");
        setLastUsage(findLastUsage(entries));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    },
    [liveInstances, liveSessionFile, nextId, sendWs],
  );

  const returnToLive = useCallback(() => {
    setViewingActiveSession(true);
    setActiveSessionFile(liveSessionFile);
    sendWs({ type: "mirror_sync_request" });
  }, [liveSessionFile, sendWs]);

  const launchProject = useCallback(
    async (projectPath: string) => {
      try {
        await fetch("/api/projects/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: projectPath }),
        });
        addSystemMessage(`Launching ${projectPath}`, "success");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to launch project");
      }
    },
    [addSystemMessage],
  );

  const openSettings = useCallback(async () => {
    setSettingsOpen(true);
    await refreshState();
    try {
      const result = await rpc({ type: "get_auth" });
      setAuthConfigured(Boolean(result.data?.configured));
      setAuthEnabled(Boolean(result.data?.enabled));
    } catch {
      setAuthConfigured(false);
    }
  }, [refreshState, rpc]);

  const toggleAuth = useCallback(async () => {
    try {
      const result = await rpc({ type: "set_auth", enabled: !authEnabled });
      setAuthEnabled(Boolean(result.data?.enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update auth");
    }
  }, [authEnabled, rpc]);

  const compactContext = useCallback(async () => {
    try {
      await rpc({ type: "compact" });
      addSystemMessage("Compaction requested");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compaction failed");
    }
  }, [addSystemMessage, rpc]);

  const exportHtml = useCallback(async () => {
    try {
      const result = await rpc({ type: "export_html" });
      if (result.data?.path) addSystemMessage(`Exported: ${result.data.path}`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }, [addSystemMessage, rpc]);

  const showSessionStats = useCallback(async () => {
    try {
      const result = await rpc({ type: "get_session_stats" });
      const stats = result.data;
      addSystemMessage(
        [
          "Session stats",
          `Messages: ${stats.totalMessages} (${stats.userMessages} user, ${stats.assistantMessages} assistant)`,
          `Tool calls: ${stats.toolCalls}`,
          stats.tokens ? `Context: ~${formatTokens(stats.tokens.input || stats.tokens.total || 0)} tokens` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stats failed");
    }
  }, [addSystemMessage, rpc]);

  const toggleAllTools = useCallback((open: boolean) => {
    setItems((current) =>
      current.map((item) => (item.kind === "tool" && isToolExpandable(item) ? { ...item, open } : item)),
    );
  }, []);

  const renameActiveSession = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await rpc({ type: "set_session_name", name: trimmed });
        setSessionName(trimmed);
        setProjects((current) =>
          current.map((project) => ({
            ...project,
            sessions: project.sessions.map((session) =>
              session.filePath === activeSessionFile ? { ...session, name: trimmed } : session,
            ),
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Rename failed");
      }
    },
    [activeSessionFile, rpc],
  );

  const respondDialog = useCallback(
    (response: Record<string, unknown>) => {
      if (!dialog) return;
      sendWs({ type: "extension_ui_response", id: dialog.id, ...response });
      setDialog(null);
    },
    [dialog, sendWs],
  );

  useEffect(() => {
    if (!dialog?.timeout) return;
    const timeout = window.setTimeout(() => respondDialog({ cancelled: true }), dialog.timeout);
    return () => window.clearTimeout(timeout);
  }, [dialog, respondDialog]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      } else if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.focus();
      } else if (event.key === "Escape") {
        if (commandOpen) setCommandOpen(false);
        else if (modelOpen) setModelOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (chatStatus === "streaming") abort();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [abort, chatStatus, commandOpen, modelOpen, settingsOpen]);

  const totalCost = useMemo(
    () => items.reduce((sum, item) => sum + (item.kind === "message" ? item.cost || 0 : 0), 0),
    [items],
  );

  const usedContextTokens = (lastUsage?.input || 0) + (lastUsage?.cacheRead || 0);
  const contextPercent = contextWindowSize > 0 ? Math.round((usedContextTokens / contextWindowSize) * 100) : 0;
  const shouldSuggestCompaction = contextPercent >= 80;
  const subagentItems = useMemo(() => subagentList(subagents), [subagents]);
  const selectedSubagent = selectedSubagentId ? subagents[selectedSubagentId] : null;

  const commandActions = [
    {
      label: "Compact",
      desc: "Compact context to save tokens",
      icon: ArchiveIcon,
      action: compactContext,
    },
    {
      label: "Export HTML",
      desc: "Export current session as HTML",
      icon: DownloadIcon,
      action: exportHtml,
    },
    {
      label: "Session Stats",
      desc: "Show message and tool call counts",
      icon: BarChart3Icon,
      action: showSessionStats,
    },
    {
      label: "Expand All Tools",
      desc: "Open every tool card",
      icon: PanelLeftOpenIcon,
      action: () => toggleAllTools(true),
    },
    {
      label: "Collapse All Tools",
      desc: "Close every tool card",
      icon: PanelLeftCloseIcon,
      action: () => toggleAllTools(false),
    },
  ];

  return (
    <TooltipProvider>
      <main className="flex h-full min-h-0 bg-background text-foreground">
        {sidebarOpen && (
          <button
            aria-label="Close sidebar"
            className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
            type="button"
          />
        )}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-80 flex-col border-r bg-background transition-transform md:static md:z-auto",
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:hidden",
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BotIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm">Tau</div>
              <div className="text-muted-foreground text-xs">Pi mirror</div>
            </div>
            <Button onClick={loadSessions} size="icon-sm" type="button" variant="ghost">
              <RefreshCwIcon className="size-4" />
            </Button>
          </div>

          <div className="border-b p-3">
            <div className="flex rounded-md bg-muted p-1">
              <button
                className={cn("flex-1 rounded-sm px-2 py-1 text-sm", view === "chat" && "bg-background shadow-xs")}
                onClick={() => setView("chat")}
                type="button"
              >
                Sessions
              </button>
              <button
                className={cn("flex-1 rounded-sm px-2 py-1 text-sm", view === "projects" && "bg-background shadow-xs")}
                onClick={() => setView("projects")}
                type="button"
              >
                Projects
              </button>
            </div>
            {view === "chat" && (
              <div className="relative mt-3">
                <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  onChange={(event) => setSessionQuery(event.target.value)}
                  placeholder="Search sessions..."
                  value={sessionQuery}
                />
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {view === "chat" ? (
              <SessionSidebar
                activeSessionFile={activeSessionFile}
                collapsedProjects={collapsedProjects}
                favourites={favourites}
                liveFiles={
                  new Set(
                    [liveSessionFile, ...liveInstances.map((instance) => instance.sessionFile)].filter(
                      Boolean,
                    ) as string[],
                  )
                }
                loading={sessionsLoading}
                onRename={renameActiveSession}
                onSelect={selectSession}
                onToggleCollapsed={(dirName) => setCollapsedProjects((current) => toggleSetValue(current, dirName))}
                onToggleFavourite={(filePath) =>
                  setFavourites((current) =>
                    current.includes(filePath) ? current.filter((item) => item !== filePath) : [...current, filePath],
                  )
                }
                projects={projects}
                query={sessionQuery}
                searchResults={searchResults}
              />
            ) : (
              <ProjectLauncher loading={launcherLoading} onLaunch={launchProject} projects={launcherProjects} />
            )}
          </div>

          <div className="shrink-0 border-t p-2">
            <Button className="w-full justify-start gap-2" onClick={openSettings} type="button" variant="ghost">
              <Settings2Icon className="size-4" />
              <span>Settings</span>
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button onClick={() => setSidebarOpen((open) => !open)} size="icon-sm" type="button" variant="ghost">
                <MenuIcon className="size-4" />
              </Button>
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{sessionName}</div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <ConnectionDot state={connection} />
                  <span>
                    {connection}
                    {tailscaleUrl ? " / TS" : ""}
                  </span>
                  <span>/</span>
                  <span>{modelLabel}</span>
                  {!viewingActiveSession && <span className="text-amber-600">history</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {!viewingActiveSession && (
                <Button onClick={returnToLive} size="sm" type="button" variant="secondary">
                  Live
                </Button>
              )}
              <Button onClick={openModelPicker} size="sm" type="button" variant="outline">
                <ChevronsUpDownIcon className="size-4" />
                <span className="hidden sm:inline">{modelLabel}</span>
              </Button>
              <Button onClick={cycleThinking} size="sm" type="button" variant="outline">
                <BrainIcon className="size-4" />
                <span className="hidden sm:inline">{thinkingLevel}</span>
              </Button>
              {contextWindowSize > 0 && (
                <Button
                  className={cn(shouldSuggestCompaction && "border-amber-500 text-amber-600")}
                  onClick={() => setContextOpen((open) => !open)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {contextPercent}%
                </Button>
              )}
              {totalCost > 0 && (
                <div className="hidden rounded-md border px-2 py-1 text-muted-foreground text-xs lg:block">
                  ${totalCost.toFixed(4)}
                </div>
              )}
              {shouldSuggestCompaction && (
                <Button onClick={compactContext} size="sm" type="button" variant="secondary">
                  Compact
                </Button>
              )}
              <Button onClick={() => setCommandOpen(true)} size="icon-sm" type="button" variant="ghost">
                <CommandIcon className="size-4" />
              </Button>
            </div>
          </header>

          <div className="relative min-h-0 flex-1">
            <Conversation className="h-full">
              <ConversationContent className="mx-auto w-full max-w-3xl gap-3 px-4 py-6">
                {items.length === 0 ? (
                  <ConversationEmptyState
                    description="Connect to the running Pi session and send a message."
                    icon={<TerminalIcon className="size-7" />}
                    title="Tau"
                  />
                ) : (
                  items.map((item) =>
                    item.kind === "message" && item.role === "user" ? (
                      <UserMessageView
                        item={item as typeof item & { kind: "message"; role: "user" }}
                        key={item.id}
                        onCopy={(text) => copyText(text)}
                        onEdit={advancedFeatures && item.entryId ? handleEditSubmit : undefined}
                      />
                    ) : (
                      <ChatItemView
                        item={item}
                        key={item.id}
                        onCopy={(text) => copyText(text)}
                        onToggleTool={(id, open) =>
                          setItems((current) =>
                            current.map((candidate) =>
                              candidate.kind === "tool" && candidate.id === id ? { ...candidate, open } : candidate,
                            ),
                          )
                        }
                        showThinking={showThinking}
                      />
                    ),
                  )
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {contextOpen && (
              <ContextPopover
                contextWindowSize={contextWindowSize}
                lastUsage={lastUsage}
                onClose={() => setContextOpen(false)}
              />
            )}
            {!selectedSubagent && !contextOpen && (
              <WorkspaceStatusFloat onOpenSubagent={setSelectedSubagentId} subagents={subagentItems} />
            )}
          </div>

          {queuedMessages.length > 0 && (
            <div className="mx-auto w-full max-w-3xl px-4 pt-2">
              <div className="flex flex-wrap gap-2">
                {queuedMessages.map((queued) => (
                  <div className="flex items-center gap-2 rounded-md border bg-muted px-2 py-1 text-xs" key={queued.id}>
                    <span className="text-muted-foreground">Queued</span>
                    <span className="max-w-72 truncate">{queued.message}</span>
                    <button
                      onClick={() =>
                        setQueuedMessages((current) => current.filter((candidate) => candidate.id !== queued.id))
                      }
                      type="button"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mx-auto w-full max-w-3xl px-4 py-2">
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                {error}
              </div>
            </div>
          )}

          <footer className="shrink-0 border-t bg-background/95 px-4 py-3">
            <div className="mx-auto w-full max-w-3xl">
              <PromptInput
                accept="image/*"
                className={cn("rounded-xl border bg-card shadow-sm", !viewingActiveSession && "opacity-70")}
                globalDrop={viewingActiveSession}
                multiple
                onSubmit={submitMessage}
              >
                <PromptAttachmentPreview />
                <PromptInputBody>
                  <PromptInputTextarea
                    className="min-h-20 resize-none"
                    disabled={!viewingActiveSession}
                    placeholder={viewingActiveSession ? "Message Pi..." : "Viewing historical session"}
                  />
                </PromptInputBody>
                <PromptInputFooter>
                  <PromptInputTools>
                    <PromptAttachmentButton disabled={!viewingActiveSession} />
                    <div className="hidden items-center gap-1 px-2 text-muted-foreground text-xs sm:flex">
                      Enter sends, Shift+Enter inserts a newline
                    </div>
                  </PromptInputTools>
                  <PromptInputSubmit disabled={!viewingActiveSession} onStop={abort} status={chatStatus} />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </footer>
        </div>

        {selectedSubagent && (
          <SubagentDetailSidebar agent={selectedSubagent} onClose={() => setSelectedSubagentId(null)} />
        )}

        {modelOpen && (
          <ModelPicker
            currentModel={currentModel}
            models={availableModels}
            onClose={() => setModelOpen(false)}
            onSelect={selectModel}
            query={modelSearch}
            setQuery={setModelSearch}
          />
        )}
        {settingsOpen && (
          <SettingsPanel
            authConfigured={authConfigured}
            authEnabled={authEnabled}
            autoCompaction={autoCompaction}
            onClose={() => setSettingsOpen(false)}
            onRenameSession={renameActiveSession}
            onSetAutoCompaction={async (enabled) => {
              setAutoCompaction(enabled);
              await rpc({ type: "set_auto_compaction", enabled });
            }}
            onSetTheme={setThemeMode}
            onSetThinking={async (level) => {
              await rpc({ type: "set_thinking_level", level });
              setThinkingLevel(level);
            }}
            onToggleAuth={toggleAuth}
            sessionName={sessionName}
            showThinking={showThinking}
            setShowThinking={setShowThinking}
            themeMode={themeMode}
            thinkingLevel={thinkingLevel}
          />
        )}
        {commandOpen && <CommandPalette commands={commandActions} onClose={() => setCommandOpen(false)} />}
        {dialog && (
          <ExtensionDialogView
            dialog={dialog}
            onCancel={() => respondDialog({ cancelled: true })}
            onRespond={respondDialog}
          />
        )}
      </main>
    </TooltipProvider>
  );
}
