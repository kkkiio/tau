/**
 * Mirror Server Extension
 *
 * Starts a WebSocket + HTTP server inside the running Pi process,
 * allowing a browser to connect and mirror the TUI session in real-time.
 *
 * - Forwards all Pi events to connected browser clients
 * - Accepts commands from the browser and executes them via the extension API
 * - Serves static files for the Tau web UI
 * - Sends full state snapshot on client connect (messages, model, etc.)
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import QRCode from "qrcode";
import { WebSocket, WebSocketServer } from "ws";

type TauSettingsData = {
  port?: string | number;
  disabled?: boolean;
  user?: string;
  pass?: string;
  authEnabled?: boolean;
  projectsDir?: string;
};

type RunningInstance = {
  port: number;
  pid: number;
  sessionFile: string;
  cwd: string;
};

type BrowserImage = {
  data?: string;
  mimeType?: string;
};

type BrowserCommand = {
  id?: string;
  type?: string;
  message?: string;
  images?: BrowserImage[];
  streamingBehavior?: string;
  provider?: string;
  modelId?: string;
  level?: "off" | "minimal" | "low" | "medium" | "high";
  name?: string;
  customInstructions?: string;
  outputPath?: string;
  enabled?: boolean;
};

type BrowserResponse = {
  type: "response";
  command: string;
  success: boolean;
  id?: string;
  data?: unknown;
  error?: string;
};

type TextContentBlock = {
  type: "text";
  text: string;
};

type ImageContentBlock = {
  type: "image";
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

type SessionEntry = {
  type?: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  name?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type ParsedSession = {
  id: string;
  timestamp: string;
  name: string | null;
  firstMessage: string | null;
  cwd: string | null;
};

type SessionListItem = ParsedSession & {
  file: string;
  filePath: string;
  mtime: number;
  tmux?: true;
};

type ProjectSessionGroup = {
  path: string;
  dirName: string;
  sessions: SessionListItem[];
};

type FileListItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
  mtime: number;
};

type SearchMatch = {
  role: string;
  snippet: string;
};

type SearchResult = {
  filePath: string;
  project: string;
  sessionId: string;
  sessionName: string;
  sessionTimestamp: string;
  firstMessage: string;
  matches: SearchMatch[];
};

type ModelCandidate = {
  provider?: string;
  id?: string;
};

type ExtensionAPIWithEvents = ExtensionAPI & {
  events?: {
    on?: (eventType: string, listener: (payload: unknown) => void) => void;
  };
};

type AliveWebSocket = WebSocket & {
  isAlive?: boolean;
};

type WritableSocket = Pick<WebSocket, "readyState" | "send">;

type NodeError = Error & {
  code?: string;
};

// Load tau settings from ~/.pi/agent/settings.json (falls back to env vars)
function loadTauSettings(): {
  port: number;
  autoStart: boolean;
  user: string;
  pass: string;
  authEnabled?: boolean;
  projectsDir?: string;
} {
  let settings: TauSettingsData = {};
  try {
    const settingsPath = path.join(process.env.HOME || "~", ".pi/agent/settings.json");
    settings =
      (
        JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
          tau?: TauSettingsData;
        }
      ).tau || {};
  } catch {}
  return {
    port: parseInt(String(process.env.TAU_MIRROR_PORT || settings.port || "3001"), 10),
    autoStart: !(process.env.TAU_DISABLED === "1" || process.env.TAU_DISABLED === "true" || settings.disabled === true),
    user: process.env.TAU_USER || settings.user || "",
    pass: process.env.TAU_PASS || settings.pass || "",
    authEnabled: settings.authEnabled,
    projectsDir: process.env.TAU_PROJECTS_DIR || settings.projectsDir,
  };
}

const TAU_SETTINGS = loadTauSettings();
const PORT = TAU_SETTINGS.port;
const TAU_AUTO_START = TAU_SETTINGS.autoStart;
const AUTH_USER = TAU_SETTINGS.user;
const AUTH_PASS = TAU_SETTINGS.pass;
const AUTH_CONFIGURED = !!(AUTH_USER && AUTH_PASS);
let authEnabled = AUTH_CONFIGURED && TAU_SETTINGS.authEnabled !== false;
// @ts-expect-error — __dirname is provided by jiti at runtime
const STATIC_DIR = process.env.TAU_STATIC_DIR || findStaticDir();

function findStaticDir(): string {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (dir: string) => {
    const normalized = path.resolve(dir);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  // 1) Bundled React build output, then legacy public fallback.
  addCandidate(path.resolve(__dirname, "dist"));
  addCandidate(path.resolve(__dirname, "../dist"));
  addCandidate(path.resolve(__dirname, "public"));
  addCandidate(path.resolve(__dirname, "../public"));

  // 2) Installed package path (for npm-installed extension execution)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkgPath = require.resolve("tau-mirror/package.json");
    const pkgDir = path.dirname(pkgPath);
    addCandidate(path.join(pkgDir, "dist"));
    addCandidate(path.join(pkgDir, "public"));
  } catch {}

  // 3) Development fallback from current working directory
  addCandidate(path.resolve(process.cwd(), "dist"));
  addCandidate(path.resolve(process.cwd(), "public"));
  addCandidate(path.resolve(process.cwd(), "node_modules/tau-mirror/dist"));
  addCandidate(path.resolve(process.cwd(), "node_modules/tau-mirror/public"));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) return candidate;
  }

  return path.resolve(process.cwd(), "dist");
}
const SESSIONS_DIR = path.join(process.env.HOME || "~", ".pi/agent/sessions");
const INSTANCES_DIR = path.join(process.env.HOME || "~", ".pi/tau-instances");

// Instance registry — tracks all running Tau servers
function registerInstance(port: number, sessionFile: string, cwd: string) {
  fs.mkdirSync(INSTANCES_DIR, { recursive: true });
  const info = {
    port,
    pid: process.pid,
    sessionFile,
    cwd,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(INSTANCES_DIR, `${process.pid}.json`), JSON.stringify(info));
}

function updateInstanceSession(sessionFile: string) {
  const file = path.join(INSTANCES_DIR, `${process.pid}.json`);
  if (!fs.existsSync(file)) return;
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8")) as RunningInstance;
    info.sessionFile = sessionFile;
    fs.writeFileSync(file, JSON.stringify(info));
  } catch {}
}

function unregisterInstance() {
  try {
    fs.unlinkSync(path.join(INSTANCES_DIR, `${process.pid}.json`));
  } catch {}
}

function getRunningInstances(): Array<{
  port: number;
  pid: number;
  sessionFile: string;
  cwd: string;
}> {
  if (!fs.existsSync(INSTANCES_DIR)) return [];
  const instances: RunningInstance[] = [];
  for (const file of fs.readdirSync(INSTANCES_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, file), "utf8")) as
        | RunningInstance
        | Partial<RunningInstance>;
      if (typeof info.pid !== "number") continue;
      // Check if process is still alive
      try {
        process.kill(info.pid, 0);
        instances.push(info as RunningInstance);
      } catch {
        // Process dead — clean up stale file
        try {
          fs.unlinkSync(path.join(INSTANCES_DIR, file));
        } catch {}
      }
    } catch {}
  }
  return instances;
}

/**
 * Kill zombie Tau instances — processes that are alive but orphaned
 * (e.g. tmux pane was killed without session_shutdown firing).
 * A zombie is detected by checking if the process has a controlling terminal.
 * If it doesn't, the HTTP server is the only thing keeping it alive.
 */
function cleanupZombieInstances() {
  if (!fs.existsSync(INSTANCES_DIR)) return;
  const { execSync } = require("node:child_process");
  for (const file of fs.readdirSync(INSTANCES_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(INSTANCES_DIR, file), "utf8")) as
        | RunningInstance
        | Partial<RunningInstance>;
      if (typeof info.pid !== "number") continue;
      // Skip our own process
      if (info.pid === process.pid) continue;
      // Check if process is alive
      try {
        process.kill(info.pid, 0);
      } catch {
        // Already dead — clean up
        try {
          fs.unlinkSync(path.join(INSTANCES_DIR, file));
        } catch {}
        continue;
      }
      // Check if process has a controlling terminal (TTY)
      // Orphaned processes from killed tmux panes lose their TTY
      try {
        const tty = execSync(`ps -o tty= -p ${info.pid}`, {
          encoding: "utf8",
        }).trim();
        if (!tty || tty === "??" || tty === "-") {
          // No terminal — this is a zombie, kill it
          process.kill(info.pid, "SIGTERM");
          try {
            fs.unlinkSync(path.join(INSTANCES_DIR, file));
          } catch {}
        }
      } catch {
        // ps failed — process might have died between checks, clean up
        try {
          fs.unlinkSync(path.join(INSTANCES_DIR, file));
        } catch {}
      }
    } catch {}
  }
}

// MIME types for static file serving
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function saveTauSetting(key: string, value: unknown) {
  const settingsPath = path.join(process.env.HOME || "~", ".pi/agent/settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      tau?: Record<string, unknown>;
    };
    if (!settings.tau) settings.tau = {};
    settings.tau[key] = value;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch {}
}

function checkBasicAuth(req: http.IncomingMessage): boolean {
  if (!authEnabled) return true;
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const colon = decoded.indexOf(":");
  if (colon === -1) return false;
  return decoded.slice(0, colon) === AUTH_USER && decoded.slice(colon + 1) === AUTH_PASS;
}

function sendAuthRequired(res: http.ServerResponse) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Tau"',
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

export default function (pi: ExtensionAPI) {
  let server: http.Server | null = null;
  let wss: WebSocketServer | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const clients = new Set<WebSocket>();

  // Store latest context reference for use in command handlers
  let latestCtx: ExtensionContext | null = null;

  // ═══════════════════════════════════════
  // Helper: send to one client
  // ═══════════════════════════════════════
  function sendTo(ws: WritableSocket, data: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ═══════════════════════════════════════
  // Helper: broadcast to all clients
  // ═══════════════════════════════════════
  function broadcast(data: unknown) {
    const json = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  let mirrorUrl = "";
  let tailscaleUrl = "";
  let mirrorStatusBase = "";

  function updateMirrorStatus() {
    if (!mirrorStatusBase) {
      latestCtx?.ui.setStatus("mirror", "");
      return;
    }
    const clientCount = clients.size;
    const clientText = clientCount > 0 ? ` • ${clientCount} web ${clientCount === 1 ? "client" : "clients"}` : "";
    latestCtx?.ui.setStatus("mirror", `${mirrorStatusBase}${clientText}`);
  }

  // ═══════════════════════════════════════
  // Helper: stop the server
  // ═══════════════════════════════════════
  function stopServer() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (wss) {
      for (const client of clients) {
        client.close();
      }
      clients.clear();
      try {
        wss.close();
      } catch {}
      wss = null;
    }
    if (server) {
      try {
        server.close();
      } catch {}
      server = null;
    }
    unregisterInstance();
    mirrorUrl = "";
    tailscaleUrl = "";
    mirrorStatusBase = "";
  }

  // ═══════════════════════════════════════
  // /tau-stop and /tau-start commands
  // ═══════════════════════════════════════
  pi.registerCommand("taustop", {
    description: "Stop the Tau mirror server",
    handler: async (_args, ctx) => {
      if (!server) {
        ctx.ui.notify("Tau is not running", "warning");
        return;
      }
      stopServer();
      ctx.ui.setStatus("mirror", "");
      ctx.ui.notify("Tau mirror server stopped", "info");
    },
  });

  pi.registerCommand("taustart", {
    description: "Start the Tau mirror server",
    handler: async (_args, ctx) => {
      if (server) {
        ctx.ui.notify(`Tau is already running at ${mirrorUrl}`, "warning");
        return;
      }
      startServer(ctx);
      ctx.ui.notify("Tau mirror server starting...", "info");
    },
  });

  // ═══════════════════════════════════════
  // /qr command — show QR code to connect
  // ═══════════════════════════════════════
  pi.registerCommand("tau", {
    description: "Open Tau web UI in browser",
    handler: async (_args, ctx) => {
      if (!mirrorUrl) {
        ctx.ui.notify("Mirror server not running yet", "warning");
        return;
      }
      const { exec } = require("node:child_process");
      exec(`open "${mirrorUrl}"`);
      ctx.ui.notify(`Opened ${mirrorUrl}`, "info");
    },
  });

  pi.registerCommand("qr", {
    description: "Show QR code for Tau mirror URL",
    handler: async (_args, ctx) => {
      if (!mirrorUrl) {
        ctx.ui.notify("Mirror server not running yet", "warning");
        return;
      }
      const qrPageUrl = `${mirrorUrl}/api/qr`;
      ctx.ui.notify(`Tau: ${mirrorUrl}  •  QR: ${qrPageUrl}`, "info");
      // Open in default browser
      const { exec } = require("node:child_process");
      exec(`open "${qrPageUrl}"`);
    },
  });

  // ═══════════════════════════════════════
  // Event forwarding — subscribe to all Pi events
  // ═══════════════════════════════════════
  const eventTypes = [
    "agent_start",
    "agent_end",
    "turn_start",
    "turn_end",
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "auto_compaction_start",
    "auto_compaction_end",
    "auto_retry_start",
    "auto_retry_end",
    "model_select",
  ] as const;

  for (const eventType of eventTypes) {
    pi.on(eventType as Parameters<ExtensionAPI["on"]>[0], async (event: unknown, ctx: ExtensionContext) => {
      latestCtx = ctx;
      const eventPayload = typeof event === "object" && event !== null ? (event as Record<string, unknown>) : {};

      // Forward event to all connected browser clients
      // Wrap in { type: "event", event: ... } to match the existing frontend protocol
      broadcast({
        type: "event",
        event: { type: eventType, ...eventPayload },
      });
    });
  }

  const subagentEventTypes = [
    "subagents:ready",
    "subagents:created",
    "subagents:started",
    "subagents:completed",
    "subagents:failed",
    "subagents:steered",
    "subagents:compacted",
    "subagents:scheduled",
    "subagents:scheduler_ready",
    "subagents:settings_loaded",
    "subagents:settings_changed",
  ] as const;

  for (const eventType of subagentEventTypes) {
    (pi as ExtensionAPIWithEvents).events?.on?.(eventType, (payload: unknown) => {
      broadcast({ type: "event", event: { type: eventType, payload } });
    });
  }

  // Also capture context from session events
  // Auto-title: collect user messages and generate a title after a few turns
  let turnCount = 0;
  let titleSet = false;
  let userMessages: string[] = [];

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    turnCount = 0;
    titleSet = false;
    userMessages = [];
    // Update instance registry with new session file
    updateInstanceSession(ctx.sessionManager.getSessionFile() || "");
  });

  pi.on("turn_start", async (_event, _ctx) => {
    turnCount++;
  });

  // Capture user messages for title generation via message_start
  pi.on("message_start", async (event, _ctx) => {
    if (titleSet) return;
    const msg = event.message;
    if (!msg || msg.role !== "user") return;
    const content = msg.content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      const tb = content.find(
        (b): b is TextContentBlock =>
          typeof b === "object" &&
          b !== null &&
          (b as { type?: unknown }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      );
      if (tb) text = tb.text;
    }
    if (text) userMessages.push(text.substring(0, 300));
  });

  pi.on("turn_end", async (_event, _ctx) => {
    if (titleSet || turnCount < 2) return;

    const sessionName = pi.getSessionName();
    if (sessionName && sessionName !== "New Session" && sessionName !== "Untitled") {
      titleSet = true;
      return;
    }

    // Generate title from collected messages
    const title = generateSessionTitle(userMessages);
    if (title) {
      pi.setSessionName(title);
      titleSet = true;
      // Broadcast to connected clients
      broadcast({
        type: "event",
        event: { type: "session_name", name: title },
      });
    }
  });

  function generateSessionTitle(messages: string[]): string | null {
    if (messages.length === 0) return null;

    // Find first substantive message (skip greetings and memory instructions)
    const greetings = /^(hey|hello|hi|morning|good morning|howdy|yo|sup)[\s!.:,]*$/i;
    const memoryInstructions = /read (your |the )?(memory|seed|persona|working) files/i;

    let bestMessage = "";
    for (const msg of messages) {
      const cleaned = msg.trim();
      if (greetings.test(cleaned)) continue;
      if (memoryInstructions.test(cleaned)) continue;
      if (cleaned.length < 10) continue;
      bestMessage = cleaned;
      break;
    }

    if (!bestMessage) {
      // Fall back to first message with any content
      bestMessage = messages.find((m) => m.trim().length > 0) || "";
    }

    if (!bestMessage) return null;

    // Extract a clean title: first sentence or clause, max ~60 chars
    let title = bestMessage
      .replace(/^(ok |okay |so |actually |hey |please |can you |could you |i want(ed)? to |i wanna |let'?s )/i, "")
      .replace(/\n.*/s, "") // first line only
      .trim();

    // Take first sentence
    const sentenceEnd = title.search(/[.!?]\s/);
    if (sentenceEnd > 10 && sentenceEnd < 80) {
      title = title.substring(0, sentenceEnd);
    }

    // Truncate cleanly
    if (title.length > 60) {
      const spaceIdx = title.lastIndexOf(" ", 57);
      title = `${title.substring(0, spaceIdx > 20 ? spaceIdx : 57)}…`;
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    return title;
  }

  // ═══════════════════════════════════════
  // Build state snapshot for new connections
  // ═══════════════════════════════════════
  async function buildStateSnapshot(ctx: ExtensionContext) {
    // Get session entries for message history
    const entries = ctx.sessionManager.getEntries();

    // Get model info
    const model = ctx.model;
    const thinkingLevel = pi.getThinkingLevel();
    const sessionName = pi.getSessionName();
    const sessionFile = ctx.sessionManager.getSessionFile();

    // Context usage
    const contextUsage = ctx.getContextUsage();

    return {
      type: "mirror_sync",
      entries,
      model,
      thinkingLevel,
      sessionName,
      sessionFile,
      isStreaming: !ctx.isIdle(),
      contextUsage,
    };
  }

  // ═══════════════════════════════════════
  // Handle commands from browser clients
  // ═══════════════════════════════════════
  async function handleCommand(ws: WritableSocket, command: BrowserCommand) {
    const id = command.id;
    const ctx = latestCtx;

    const success = (cmd: string, data?: unknown) => {
      const resp: BrowserResponse = {
        type: "response",
        command: cmd,
        success: true,
        id,
      };
      if (data !== undefined) resp.data = data;
      return resp;
    };

    const error = (cmd: string, message: string) => {
      return {
        type: "response",
        command: cmd,
        success: false,
        error: message,
        id,
      };
    };

    try {
      switch (command.type) {
        // ─── Prompting ───
        case "prompt": {
          const message = command.message || "";
          if (ctx && !ctx.isIdle()) {
            const behavior = command.streamingBehavior || "steer";
            if (behavior === "steer") {
              pi.sendUserMessage(message, { deliverAs: "steer" });
            } else {
              pi.sendUserMessage(message, { deliverAs: "followUp" });
            }
          } else {
            // Build content with optional images
            const images = Array.isArray(command.images) ? command.images : [];
            if (images.length) {
              const validMimes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
              const content: Array<TextContentBlock | ImageContentBlock> = [
                { type: "text", text: message || "(see attached image)" },
              ];
              for (const img of images) {
                if (!img.data || typeof img.data !== "string") {
                  continue;
                }
                // Strip data URL prefix if accidentally included
                const data = img.data.includes(",") ? img.data.split(",")[1] : img.data;
                const mimeType = (validMimes.includes(img.mimeType) ? img.mimeType : "image/png") as
                  | "image/png"
                  | "image/jpeg"
                  | "image/gif"
                  | "image/webp";
                const imageBlock = {
                  type: "image" as const,
                  data: data,
                  mimeType: mimeType,
                };
                if (!imageBlock.mimeType) {
                  imageBlock.mimeType = "image/png";
                }
                content.push(imageBlock);
              }
              // Only send content array if we actually have images, otherwise just text
              const hasImages = content.some((c) => c.type === "image");
              if (hasImages) {
                pi.sendUserMessage(content);
              } else {
                pi.sendUserMessage(message);
              }
            } else {
              pi.sendUserMessage(message);
            }
          }
          sendTo(ws, success("prompt"));
          break;
        }

        case "steer": {
          pi.sendUserMessage(command.message || "", { deliverAs: "steer" });
          sendTo(ws, success("steer"));
          break;
        }

        case "follow_up": {
          pi.sendUserMessage(command.message || "", { deliverAs: "followUp" });
          sendTo(ws, success("follow_up"));
          break;
        }

        case "abort": {
          if (ctx) ctx.abort();
          sendTo(ws, success("abort"));
          break;
        }

        // ─── State ───
        case "get_state": {
          if (!ctx) {
            sendTo(ws, error("get_state", "No context available"));
            break;
          }
          const model = ctx.model;
          const state = {
            model,
            thinkingLevel: pi.getThinkingLevel(),
            isStreaming: !ctx.isIdle(),
            sessionFile: ctx.sessionManager.getSessionFile(),
            sessionName: pi.getSessionName(),
            autoCompactionEnabled: true, // Extension can't easily check this
          };
          sendTo(ws, success("get_state", state));
          break;
        }

        case "get_messages": {
          if (!ctx) {
            sendTo(ws, error("get_messages", "No context available"));
            break;
          }
          const entries = ctx.sessionManager.getEntries();
          sendTo(ws, success("get_messages", { entries }));
          break;
        }

        // ─── Model ───
        case "get_available_models": {
          if (!ctx) {
            sendTo(ws, error("get_available_models", "No context available"));
            break;
          }
          const models = await ctx.modelRegistry.getAvailable();
          sendTo(ws, success("get_available_models", { models }));
          break;
        }

        case "set_model": {
          if (!ctx) {
            sendTo(ws, error("set_model", "No context available"));
            break;
          }
          const models = await ctx.modelRegistry.getAvailable();
          const model = (models as ModelCandidate[]).find(
            (m) => m.provider === command.provider && m.id === command.modelId,
          );
          if (!model) {
            sendTo(ws, error("set_model", `Model not found: ${command.provider}/${command.modelId}`));
            break;
          }
          const ok = await pi.setModel(model);
          if (!ok) {
            sendTo(ws, error("set_model", "No API key for this model"));
            break;
          }
          sendTo(ws, success("set_model", model));
          break;
        }

        case "cycle_model": {
          // Extension API doesn't have cycleModel directly
          // Workaround: get available models, find current, pick next
          if (!ctx) {
            sendTo(ws, success("cycle_model", null));
            break;
          }
          const availModels = await ctx.modelRegistry.getAvailable();
          const currentModel = ctx.model;
          if (!currentModel || availModels.length <= 1) {
            sendTo(ws, success("cycle_model", null));
            break;
          }
          const idx = (availModels as ModelCandidate[]).findIndex(
            (m) => m.provider === currentModel.provider && m.id === currentModel.id,
          );
          const nextModel = availModels[(idx + 1) % availModels.length];
          await pi.setModel(nextModel);
          sendTo(
            ws,
            success("cycle_model", {
              model: nextModel,
              thinkingLevel: pi.getThinkingLevel(),
            }),
          );
          break;
        }

        // ─── Thinking ───
        case "cycle_thinking_level": {
          const levels = ["off", "minimal", "low", "medium", "high"];
          const current = pi.getThinkingLevel();
          const idx = levels.indexOf(current);
          const next = levels[(idx + 1) % levels.length];
          pi.setThinkingLevel(next as BrowserCommand["level"]);
          sendTo(ws, success("cycle_thinking_level", { level: next }));
          break;
        }

        case "set_thinking_level": {
          pi.setThinkingLevel(command.level);
          sendTo(ws, success("set_thinking_level"));
          break;
        }

        // ─── Session ───
        case "get_session_stats": {
          if (!ctx) {
            sendTo(ws, error("get_session_stats", "No context available"));
            break;
          }
          const usage = ctx.getContextUsage();
          const entries = ctx.sessionManager.getEntries();
          let userMessages = 0,
            assistantMessages = 0,
            toolCalls = 0;
          for (const e of entries) {
            if (e.type === "message") {
              if (e.message?.role === "user") userMessages++;
              else if (e.message?.role === "assistant") assistantMessages++;
              else if (e.message?.role === "toolResult") toolCalls++;
            }
          }
          sendTo(
            ws,
            success("get_session_stats", {
              sessionFile: ctx.sessionManager.getSessionFile(),
              userMessages,
              assistantMessages,
              toolCalls,
              totalMessages: entries.length,
              tokens: usage ? { input: usage.tokens, total: usage.tokens } : null,
            }),
          );
          break;
        }

        case "set_session_name": {
          const name = command.name?.trim();
          if (!name) {
            sendTo(ws, error("set_session_name", "Name cannot be empty"));
            break;
          }
          pi.setSessionName(name);
          sendTo(ws, success("set_session_name"));
          break;
        }

        case "set_auto_compaction": {
          // Extension can't easily toggle auto-compaction
          // Just acknowledge
          sendTo(ws, success("set_auto_compaction"));
          break;
        }

        case "compact": {
          if (ctx) {
            // Broadcast compaction start to all clients
            broadcast({
              type: "event",
              event: { type: "auto_compaction_start" },
            });
            ctx.compact({
              customInstructions: command.customInstructions,
              onComplete: (result: { summary?: unknown }) => {
                broadcast({
                  type: "event",
                  event: {
                    type: "auto_compaction_end",
                    summary: result?.summary,
                  },
                });
              },
              onError: (err: Error) => {
                broadcast({
                  type: "event",
                  event: {
                    type: "auto_compaction_end",
                    summary: `Error: ${err.message}`,
                  },
                });
              },
            });
          }
          sendTo(ws, success("compact"));
          break;
        }

        case "export_html": {
          if (!ctx) {
            sendTo(ws, error("export_html", "No context available"));
            break;
          }
          try {
            const sessionFile = ctx.sessionManager.getSessionFile();
            if (!sessionFile) throw new Error("No session file to export");
            const { execSync } = require("node:child_process");
            const args = command.outputPath ? `"${sessionFile}" "${command.outputPath}"` : `"${sessionFile}"`;
            const output = execSync(`pi --export ${args}`, {
              cwd: process.cwd(),
              timeout: 30000,
              encoding: "utf-8",
            });
            // pi prints the output path
            const result = output.trim().split("\n").pop() || sessionFile.replace(".jsonl", ".html");
            sendTo(ws, success("export_html", { path: result }));
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            sendTo(ws, error("export_html", message));
          }
          break;
        }

        // ─── Commands & Files ───
        // ─── Sync ───
        case "mirror_sync_request": {
          if (ctx) {
            const snapshot = await buildStateSnapshot(ctx);
            sendTo(ws, snapshot);
          } else {
            sendTo(ws, { type: "mirror_sync", entries: [], model: null });
          }
          break;
        }

        // ─── Auth ───
        case "get_auth": {
          sendTo(
            ws,
            success("get_auth", {
              configured: AUTH_CONFIGURED,
              enabled: authEnabled,
            }),
          );
          break;
        }

        case "set_auth": {
          if (!AUTH_CONFIGURED) {
            sendTo(ws, error("set_auth", "No credentials configured. Set tau.user and tau.pass in settings.json"));
            break;
          }
          authEnabled = !!command.enabled;
          saveTauSetting("authEnabled", authEnabled);
          broadcast({
            type: "event",
            event: { type: "auth_changed", enabled: authEnabled },
          });
          sendTo(ws, success("set_auth", { enabled: authEnabled }));
          break;
        }

        default: {
          sendTo(ws, error(command.type, `Unknown command: ${command.type}`));
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      sendTo(ws, error(command.type || "unknown", message));
    }
  }

  // ═══════════════════════════════════════
  // Static file server
  // ═══════════════════════════════════════
  function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse) {
    let urlPath = req.url || "/";

    // Auth gate — exempt /api/health for monitoring
    if (authEnabled && urlPath !== "/api/health" && !checkBasicAuth(req)) {
      sendAuthRequired(res);
      return;
    }

    // Handle API routes
    if (urlPath.startsWith("/api/")) {
      handleApiRoute(req, res, urlPath);
      return;
    }

    // Strip query params
    urlPath = urlPath.split("?")[0];

    // Default to index.html
    if (urlPath === "/") urlPath = "/index.html";

    const filePath = path.join(STATIC_DIR, urlPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(STATIC_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Check file exists
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  // ═══════════════════════════════════════
  // API routes (sessions list, etc.)
  // ═══════════════════════════════════════
  function handleApiRoute(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string) {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (urlPath === "/api/qr") {
      if (!mirrorUrl) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server not ready" }));
        return;
      }
      const qrPromises = [QRCode.toDataURL(mirrorUrl, { width: 256, margin: 2 })];
      if (tailscaleUrl) qrPromises.push(QRCode.toDataURL(tailscaleUrl, { width: 256, margin: 2 }));
      Promise.all(qrPromises)
        .then((dataUrls: string[]) => {
          const tsSection =
            tailscaleUrl && dataUrls[1]
              ? `<p style="margin-top:24px;color:rgba(255,255,255,0.3);font-size:11px">TAILSCALE</p><img src="${dataUrls[1]}" width="256" height="256" alt="Tailscale QR"><a href="${tailscaleUrl}">${tailscaleUrl}</a>`
              : "";
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width"><title>Tau — Connect</title>
<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#131316;color:#fff;font-family:-apple-system,sans-serif}
img{border-radius:12px}a{color:#b87a5c;font-size:18px;margin-top:16px}p{color:rgba(255,255,255,0.5);font-size:13px;margin-top:8px}</style>
</head><body><p style="color:rgba(255,255,255,0.3);font-size:11px">LAN</p><img src="${dataUrls[0]}" width="256" height="256" alt="QR Code"><a href="${mirrorUrl}">${mirrorUrl}</a>${tsSection}<p style="margin-top:16px">Scan to open Tau on your phone</p></body></html>`);
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        });
      return;
    }

    if (urlPath === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          mode: "mirror",
          mirrorUrl,
          tailscaleUrl: tailscaleUrl || undefined,
        }),
      );
      return;
    }

    if (urlPath === "/api/instances") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ instances: getRunningInstances() }));
      return;
    }

    if (urlPath === "/api/projects" && req.method === "GET") {
      serveProjectsList(res);
      return;
    }

    if (urlPath === "/api/projects/launch" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          const { path: projectPath } = JSON.parse(body);
          if (!projectPath || typeof projectPath !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "path required" }));
            return;
          }
          // Resolve ~ in path
          const resolved = projectPath.startsWith("~")
            ? path.join(process.env.HOME || "", projectPath.slice(1))
            : projectPath;
          if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Directory not found" }));
            return;
          }
          const { execSync } = require("node:child_process");
          const escaped = resolved.replace(/'/g, "'\\''");
          execSync(
            `osascript -e 'tell app "iTerm2" to create window with default profile command "cd '"'"'${escaped}'"'"' && pi"'`,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
      });
      return;
    }

    if (urlPath === "/api/sessions" && req.method === "GET") {
      serveSessionsList(res);
      return;
    }

    // Full-text search across sessions
    if (urlPath.startsWith("/api/search") && req.method === "GET") {
      const searchUrl = new URL(`http://localhost${req.url}`);
      const q = searchUrl.searchParams.get("q") || "";
      serveSearch(res, q);
      return;
    }

    // File browser: list directory
    if (urlPath === "/api/files" || urlPath.startsWith("/api/files?")) {
      if (req.method !== "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      try {
        const filesUrl = new URL(`http://localhost${req.url}`);
        const explicitPath = filesUrl.searchParams.get("path");
        let dirPath = explicitPath || process.cwd();
        if (!explicitPath && latestCtx) {
          try {
            const entries = latestCtx.sessionManager.getEntries() as SessionEntry[];
            const sessionEntry = entries.find((e) => e.type === "session");
            if (typeof sessionEntry?.cwd === "string") dirPath = sessionEntry.cwd;
          } catch {}
        }
        serveFileList(res, dirPath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    // File browser: open file natively
    if (urlPath === "/api/open" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", async () => {
        try {
          const { filePath: fp } = JSON.parse(body);
          if (!fp || typeof fp !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "filePath required" }));
            return;
          }
          const { execFile } = await import("node:child_process");
          execFile("open", [fp], (err) => {
            if (err) latestCtx?.ui.notify(`Failed to open file: ${err.message}`, "warning");
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
      });
      return;
    }

    // Session file endpoint: /api/sessions/:dirName/:file
    const sessionMatch = urlPath.match(/^\/api\/sessions\/([^/]+)\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
      serveSessionFile(res, sessionMatch[1], sessionMatch[2]);
      return;
    }

    // RPC proxy — handle via WebSocket command handler
    if (urlPath === "/api/rpc" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", async () => {
        try {
          const command = JSON.parse(body) as BrowserCommand;
          // Create a fake WebSocket-like object to capture the response
          const responsePromise = new Promise<unknown>((resolve) => {
            const fakeWs: WritableSocket = {
              readyState: WebSocket.OPEN,
              send: (data: string | Buffer | ArrayBuffer | Buffer[]) => resolve(JSON.parse(data.toString())),
            };
            handleCommand(fakeWs, command);
          });
          const response = await responsePromise;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
      });
      return;
    }

    // Session switch — in mirror mode, this is a no-op (session is controlled by TUI)
    if (urlPath === "/api/sessions/switch" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          mirror: true,
          note: "Session switching is controlled by the TUI in mirror mode",
        }),
      );
      return;
    }

    // Memoryd check
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  // ═══════════════════════════════════════
  // Sessions list endpoint
  // ═══════════════════════════════════════
  function getTmuxSessionFiles(): Set<string> {
    try {
      const { execSync } = require("node:child_process");
      // Get tmux pane PIDs
      const paneOutput = execSync("tmux list-panes -a -F '#{pane_pid}' 2>/dev/null", {
        encoding: "utf8",
      });
      const tmuxFiles = new Set<string>();

      for (const shellPid of paneOutput.trim().split("\n").filter(Boolean)) {
        try {
          // Find Pi (node) processes that are children of tmux shells
          const children = execSync(`pgrep -P ${shellPid} 2>/dev/null`, {
            encoding: "utf8",
          });
          for (const pid of children.trim().split("\n").filter(Boolean)) {
            // Check what .jsonl files this process has open
            const lsofOut = execSync(`lsof -p ${pid} 2>/dev/null | grep '\\.jsonl'`, {
              encoding: "utf8",
            });
            for (const line of lsofOut.trim().split("\n").filter(Boolean)) {
              const match = line.match(/\/.+\.jsonl$/);
              if (match) tmuxFiles.add(match[0]);
            }
          }
        } catch {
          /* no match */
        }
      }
      return tmuxFiles;
    } catch {
      return new Set();
    }
  }

  function serveProjectsList(res: http.ServerResponse) {
    const projectsDir = TAU_SETTINGS.projectsDir;
    if (!projectsDir) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects: [] }));
      return;
    }

    const resolved = projectsDir.startsWith("~")
      ? path.join(process.env.HOME || "", projectsDir.slice(1))
      : projectsDir;

    if (!fs.existsSync(resolved)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects: [], error: "Directory not found" }));
      return;
    }

    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const instances = getRunningInstances();

      // Build session count + recency map from session history
      const sessionInfo = new Map<string, { count: number; lastActive: number }>();
      if (fs.existsSync(SESSIONS_DIR)) {
        for (const dir of fs.readdirSync(SESSIONS_DIR, {
          withFileTypes: true,
        })) {
          if (!dir.isDirectory()) continue;
          const decodedPath = dir.name.replace(/^--/, "/").replace(/--$/, "").replace(/-/g, "/");
          // Check if this session dir maps to a subdirectory of the projects folder
          if (!decodedPath.startsWith(`${resolved}/`) && !decodedPath.startsWith(resolved)) continue;

          const sessionDir = path.join(SESSIONS_DIR, dir.name);
          const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
          let lastMtime = 0;
          for (const f of files) {
            try {
              const stat = fs.statSync(path.join(sessionDir, f));
              if (stat.mtimeMs > lastMtime) lastMtime = stat.mtimeMs;
            } catch {}
          }
          sessionInfo.set(decodedPath, {
            count: files.length,
            lastActive: lastMtime,
          });
        }
      }

      const projects = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => {
          const fullPath = path.join(resolved, e.name);
          const info = sessionInfo.get(fullPath) || { count: 0, lastActive: 0 };
          const isActive = instances.some((i) => i.cwd === fullPath);
          return {
            name: e.name,
            path: fullPath,
            sessionCount: info.count,
            lastActive: info.lastActive || null,
            active: isActive,
          };
        });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }

  async function serveSessionsList(res: http.ServerResponse) {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ projects: [] }));
        return;
      }

      const tmuxFiles = getTmuxSessionFiles();
      const readline = await import("node:readline");
      const dirEntries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
      const projects: ProjectSessionGroup[] = [];

      for (const dir of dirEntries) {
        if (!dir.isDirectory()) continue;

        const projectDir = path.join(SESSIONS_DIR, dir.name);
        const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
        const decodedPath = dir.name.replace(/^--/, "/").replace(/--$/, "").replace(/-/g, "/");

        const sessions: SessionListItem[] = [];

        for (const file of files) {
          try {
            const filePath = path.join(projectDir, file);
            const parsed = await parseSessionFile(filePath, readline);
            if (parsed) {
              const stat = fs.statSync(filePath);
              const isTmux = tmuxFiles.has(filePath);
              sessions.push({
                ...parsed,
                file,
                filePath,
                mtime: stat.mtimeMs,
                ...(isTmux && { tmux: true }),
              });
            }
          } catch {
            /* skip */
          }
        }

        sessions.sort((a, b) => b.mtime - a.mtime);

        if (sessions.length > 0) {
          projects.push({ path: decodedPath, dirName: dir.name, sessions });
        }
      }

      projects.sort((a, b) => {
        const aTime = a.sessions[0]?.mtime || 0;
        const bTime = b.sessions[0]?.mtime || 0;
        return bTime - aTime;
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }

  // ═══════════════════════════════════════
  // Session file endpoint
  // ═══════════════════════════════════════
  function serveSessionFile(res: http.ServerResponse, dirName: string, file: string) {
    const filePath = path.join(SESSIONS_DIR, dirName, file);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const entries: unknown[] = [];
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    let buffer = "";

    stream.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            /* skip */
          }
        }
      }
    });

    stream.on("end", () => {
      if (buffer.trim()) {
        try {
          entries.push(JSON.parse(buffer));
        } catch {
          /* skip */
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries }));
    });

    stream.on("error", (e: Error) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    });
  }

  // ═══════════════════════════════════════
  // Parse session file header
  // ═══════════════════════════════════════
  async function parseSessionFile(
    filePath: string,
    readline: typeof import("node:readline"),
  ): Promise<ParsedSession | null> {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let header: SessionEntry | null = null;
    let firstMessage: string | null = null;
    let sessionName: string | null = null;
    let userMessageCount = 0;
    let lineCount = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      lineCount++;

      try {
        const entry = JSON.parse(line) as SessionEntry;
        if (entry.type === "session") header = entry;
        else if (entry.type === "session_info" && entry.name) sessionName = entry.name;
        else if (entry.type === "message" && entry.message?.role === "user") {
          userMessageCount++;
          if (!firstMessage) {
            const content = entry.message.content;
            if (typeof content === "string") firstMessage = content.substring(0, 120);
            else if (Array.isArray(content)) {
              const tb = content.find(
                (b): b is TextContentBlock =>
                  typeof b === "object" &&
                  b !== null &&
                  (b as { type?: unknown }).type === "text" &&
                  typeof (b as { text?: unknown }).text === "string",
              );
              if (tb) firstMessage = tb.text.substring(0, 120);
            }
          }
        }
      } catch {
        /* skip */
      }

      if (lineCount > 50 && firstMessage) break;
    }

    rl.close();
    stream.destroy();

    if (!header?.id) return null;
    if (userMessageCount <= 1 && lineCount <= 8) return null; // pipe mode

    return {
      id: header.id,
      timestamp: header.timestamp || "",
      name: sessionName,
      firstMessage,
      cwd: header.cwd || null,
    };
  }

  // ═══════════════════════════════════════
  // File browser
  // ═══════════════════════════════════════

  const IGNORED_NAMES = new Set([
    "node_modules",
    ".git",
    "__pycache__",
    ".DS_Store",
    ".Trash",
    ".next",
    ".nuxt",
    "dist",
    "build",
    ".cache",
    ".turbo",
    "venv",
    ".venv",
    "env",
    ".env.local",
    ".pi",
    "coverage",
    ".nyc_output",
    ".parcel-cache",
  ]);

  function serveFileList(res: http.ServerResponse, dirPath: string) {
    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not a directory" }));
        return;
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items: FileListItem[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".env") continue;
        if (IGNORED_NAMES.has(entry.name)) continue;

        try {
          const fullPath = path.join(dirPath, entry.name);
          const stat = fs.statSync(fullPath);

          items.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: entry.isDirectory() ? null : stat.size,
            mtime: stat.mtimeMs,
          });
        } catch {
          /* skip inaccessible */
        }
      }

      // Directories first, then files, both alphabetical
      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: dirPath, items }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }

  // ═══════════════════════════════════════
  // Full-text search
  // ═══════════════════════════════════════

  async function serveSearch(res: http.ServerResponse, query: string) {
    try {
      if (!query || query.length < 2) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [] }));
        return;
      }

      const q = query.toLowerCase();
      const readline = await import("node:readline");
      const results: SearchResult[] = [];
      const MAX_RESULTS = 30;

      if (!fs.existsSync(SESSIONS_DIR)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [] }));
        return;
      }

      const dirEntries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });

      for (const dir of dirEntries) {
        if (!dir.isDirectory()) continue;
        if (results.length >= MAX_RESULTS) break;

        const projectDir = path.join(SESSIONS_DIR, dir.name);
        const decodedPath = dir.name.replace(/^--/, "/").replace(/--$/, "").replace(/-/g, "/");
        const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));

        for (const file of files) {
          if (results.length >= MAX_RESULTS) break;

          try {
            const filePath = path.join(projectDir, file);
            const stream = fs.createReadStream(filePath, { encoding: "utf8" });
            const rl = readline.createInterface({
              input: stream,
              crlfDelay: Infinity,
            });

            let sessionId = "";
            let sessionName = "";
            let sessionTimestamp = "";
            let firstMessage = "";
            const matches: SearchMatch[] = [];

            for await (const line of rl) {
              if (!line.trim()) continue;
              try {
                const entry = JSON.parse(line) as SessionEntry;

                if (entry.type === "session") {
                  sessionId = entry.id;
                  sessionTimestamp = entry.timestamp || "";
                }
                if (entry.type === "session_info" && entry.name) {
                  sessionName = entry.name;
                }
                if (entry.type === "message") {
                  const content = entry.message?.content;
                  let text = "";
                  if (typeof content === "string") text = content;
                  else if (Array.isArray(content)) {
                    text = content
                      .filter(
                        (b): b is TextContentBlock =>
                          typeof b === "object" &&
                          b !== null &&
                          (b as { type?: unknown }).type === "text" &&
                          typeof (b as { text?: unknown }).text === "string",
                      )
                      .map((b) => b.text)
                      .join(" ");
                  }

                  if (!firstMessage && entry.message?.role === "user" && text) {
                    firstMessage = text.substring(0, 120);
                  }

                  if (text?.toLowerCase().includes(q)) {
                    // Extract a snippet around the match
                    const idx = text.toLowerCase().indexOf(q);
                    const start = Math.max(0, idx - 60);
                    const end = Math.min(text.length, idx + q.length + 60);
                    const snippet =
                      (start > 0 ? "…" : "") + text.substring(start, end) + (end < text.length ? "…" : "");

                    matches.push({
                      role: entry.message?.role || "unknown",
                      snippet: snippet.replace(/\n/g, " "),
                    });

                    if (matches.length >= 3) break; // max 3 matches per session
                  }
                }
              } catch {
                /* skip line */
              }
            }

            rl.close();
            stream.destroy();

            if (matches.length > 0) {
              results.push({
                filePath,
                project: decodedPath,
                sessionId,
                sessionName,
                sessionTimestamp,
                firstMessage,
                matches,
              });
            }
          } catch {
            /* skip file */
          }
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  }

  // ═══════════════════════════════════════
  // Start server function (reusable)
  // ═══════════════════════════════════════
  function startServer(ctx: ExtensionContext) {
    if (server) return; // Already running

    // Clean up zombie instances from killed tmux panes etc.
    cleanupZombieInstances();

    server = http.createServer(serveStaticFile);
    wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      if (authEnabled && !checkBasicAuth(request)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Tau"\r\n\r\n');
        socket.destroy();
        return;
      }
      if (request.url === "/ws") {
        const activeWss = wss;
        if (!activeWss) {
          socket.destroy();
          return;
        }
        activeWss.handleUpgrade(request, socket, head, (ws) => {
          activeWss.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    wss.on("connection", (ws) => {
      clients.add(ws);
      updateMirrorStatus();
      const aliveWs = ws as AliveWebSocket;
      aliveWs.isAlive = true;

      ws.on("pong", () => {
        aliveWs.isAlive = true;
      });

      // Send initial state
      sendTo(ws, { type: "state", isStreaming: false, mode: "mirror" });

      // Immediately send state snapshot
      if (latestCtx) {
        buildStateSnapshot(latestCtx).then((snapshot) => {
          sendTo(ws, snapshot);
        });
      }

      ws.on("message", (data) => {
        try {
          const command = JSON.parse(data.toString());
          handleCommand(ws, command);
        } catch (_e) {
          sendTo(ws, { type: "error", message: "Invalid client message" });
        }
      });

      ws.on("close", () => {
        clients.delete(ws);
        updateMirrorStatus();
      });

      ws.on("error", () => {
        clients.delete(ws);
        updateMirrorStatus();
      });
    });

    // Heartbeat keeps mobile/Tailscale sessions alive and removes stale clients.
    heartbeatTimer = setInterval(() => {
      let changed = false;
      for (const client of clients) {
        if (client.readyState !== WebSocket.OPEN) {
          clients.delete(client);
          changed = true;
          continue;
        }

        const aliveClient = client as AliveWebSocket;
        if (!aliveClient.isAlive) {
          try {
            client.terminate();
          } catch {}
          clients.delete(client);
          changed = true;
          continue;
        }

        aliveClient.isAlive = false;
        try {
          client.ping();
        } catch {}
      }
      if (changed) updateMirrorStatus();
    }, 20000);

    const tryListen = (port: number, maxAttempts = 10) => {
      const activeServer = server;
      if (!activeServer) return;
      activeServer.listen(port, "0.0.0.0", () => {
        onListening(port);
      });
      activeServer.once("error", (err: NodeError) => {
        if (err.code === "EADDRINUSE" && port < PORT + maxAttempts) {
          ctx.ui.setStatus("mirror", `Mirror: trying port ${port + 1}`);
          activeServer.removeAllListeners("error");
          tryListen(port + 1, maxAttempts);
        } else {
          ctx.ui.setStatus("mirror", "");
          ctx.ui.notify(`Tau mirror failed to start: ${err.message}`, "error");
          stopServer();
        }
      });
    };

    const onListening = (port: number) => {
      // Get local IP for display — prefer en0/en1 (WiFi/Ethernet) over bridges/VPNs
      const nets = require("node:os").networkInterfaces();
      let localIp = "localhost";
      const fallbackIp = "";
      const preferred = ["en0", "en1"]; // WiFi and Ethernet adapters
      for (const name of preferred) {
        for (const net of nets[name] || []) {
          if (net.family === "IPv4" && !net.internal) {
            localIp = net.address;
            break;
          }
        }
        if (localIp !== "localhost") break;
      }
      // Fallback: any LAN IP that isn't a bridge or VPN
      if (localIp === "localhost") {
        for (const name of Object.keys(nets)) {
          if (name.startsWith("bridge") || name.startsWith("utun") || name.startsWith("lo")) continue;
          for (const net of nets[name] || []) {
            if (
              net.family === "IPv4" &&
              !net.internal &&
              (net.address.startsWith("192.168.") || net.address.startsWith("10."))
            ) {
              localIp = net.address;
              break;
            }
          }
          if (localIp !== "localhost") break;
        }
      }
      if (localIp === "localhost" && fallbackIp) localIp = fallbackIp;

      // Detect Tailscale IP (100.x.x.x CGNAT range)
      let tailscaleIp = "";
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === "IPv4" && !net.internal && net.address.startsWith("100.")) {
            tailscaleIp = net.address;
            break;
          }
        }
        if (tailscaleIp) break;
      }

      mirrorUrl = `http://${localIp}:${port}`;
      tailscaleUrl = tailscaleIp ? `http://${tailscaleIp}:${port}` : "";
      mirrorStatusBase = `Mirror: ${localIp}:${port}${tailscaleIp ? ` • TS: ${tailscaleIp}:${port}` : ""}`;
      updateMirrorStatus();

      // Register this instance
      const sessionFile = ctx.sessionManager.getSessionFile() || "";
      registerInstance(port, sessionFile, ctx.cwd || process.cwd());

      ctx.ui.notify(
        `Tau mirror: ${mirrorUrl}${tailscaleUrl ? `  •  Tailscale: ${tailscaleUrl}` : ""}  •  /qr for QR code`,
        "info",
      );
    };

    tryListen(PORT);
  }

  // ═══════════════════════════════════════
  // Auto-start on session begin
  // ═══════════════════════════════════════
  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;

    if (!TAU_AUTO_START) {
      return;
    }

    startServer(ctx);
  });

  // ═══════════════════════════════════════
  // Cleanup on shutdown
  // ═══════════════════════════════════════
  pi.on("session_shutdown", async () => {
    stopServer();
  });
}
