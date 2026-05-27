/**
 * iMessage Bridge Extension
 *
 * Connects Pi to iMessage via BlueBubbles REST API.
 * Polls for incoming messages, injects them as user messages,
 * and sends assistant responses back via iMessage.
 *
 * Config via environment variables:
 *   BB_PASSWORD  - BlueBubbles server password (default: Zawsx@12)
 *   BB_URL       - BlueBubbles server URL (default: http://localhost:1234)
 *   BB_PHONE     - Phone number to bridge (default: +61435599858)
 *   BB_POLL_INTERVAL - Poll interval in ms (default: 2000)
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type BlueBubblesChat = {
  chatIdentifier?: string;
};

type BlueBubblesAttachment = {
  guid?: string;
  mimeType?: string;
};

type BlueBubblesMessage = {
  dateCreated?: number;
  isFromMe?: boolean;
  handle?: {
    address?: string;
  };
  chats?: BlueBubblesChat[];
  text?: string;
  attachments?: BlueBubblesAttachment[];
};

type BlueBubblesResponse = {
  data?: BlueBubblesMessage[];
  message?: string;
};

type TextContentBlock = {
  type: "text";
  text: string;
};

type ImageContentBlock = {
  type: "image";
  source: {
    type: "base64";
    mediaType: string;
    data: string;
  };
};

const BB_PASSWORD = process.env.BB_PASSWORD || "Zawsx@12";
const BB_URL = process.env.BB_URL || "http://localhost:1234";
const BB_PHONE = process.env.BB_PHONE || "+61435599858";
const BB_POLL_INTERVAL = parseInt(process.env.BB_POLL_INTERVAL || "2000", 10);
const CHAT_GUID = `iMessage;-;${BB_PHONE}`;
const ATTACHMENTS_DIR = path.join(process.env.HOME || "~", "claude-memory/imessage/attachments");

export default function (pi: ExtensionAPI) {
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastMessageTime = 0;
  let waitingForReply = false; // true when we've injected an iMessage and are waiting for the turn to end
  let latestCtx: ExtensionContext | null = null;
  let enabled = false;
  let bridgeStatusText = "";

  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

  // ═══════════════════════════════════════
  // HTTP helpers
  // ═══════════════════════════════════════

  function request(method: string, urlPath: string, body?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, BB_URL);
      url.searchParams.set("password", BB_PASSWORD);

      const mod = url.protocol === "https:" ? https : http;
      const payload = body ? JSON.stringify(body) : undefined;

      const req = mod.request(
        url,
        {
          method,
          headers: payload ? { "Content-Type": "application/json" } : {},
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          });
        },
      );

      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  function downloadAttachment(guid: string, mime: string): Promise<{ path: string; isAudio: boolean } | null> {
    return new Promise((resolve) => {
      const url = new URL(`/api/v1/attachment/${guid}/download`, BB_URL);
      url.searchParams.set("password", BB_PASSWORD);

      const mod = url.protocol === "https:" ? https : http;
      mod
        .get(url, (res) => {
          const contentType = res.headers["content-type"] || mime;
          const extMap: Record<string, string> = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "image/heic": ".heic",
            "video/mp4": ".mp4",
            "audio/mpeg": ".mp3",
            "audio/mp4": ".m4a",
            "audio/x-m4a": ".m4a",
            "audio/aac": ".aac",
            "audio/caf": ".caf",
            "application/pdf": ".pdf",
          };
          const isAudio = (contentType || "").startsWith("audio/");
          const ext = extMap[contentType || ""] || "";
          const filename = `${guid.replace(/\//g, "_")}${ext}`;
          const filepath = path.join(ATTACHMENTS_DIR, filename);

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            fs.writeFileSync(filepath, Buffer.concat(chunks));
            resolve({ path: filepath, isAudio });
          });
          res.on("error", () => resolve(null));
        })
        .on("error", () => resolve(null));
    });
  }

  // ═══════════════════════════════════════
  // UI state
  // ═══════════════════════════════════════

  function setBridgeStatus(text?: string) {
    const next = text || "";
    if (next === bridgeStatusText) return;
    bridgeStatusText = next;
    latestCtx?.ui.setStatus("imessage", text);
  }

  // ═══════════════════════════════════════
  // Send iMessage via BlueBubbles
  // ═══════════════════════════════════════

  async function sendIMessage(text: string) {
    try {
      await request("POST", "/api/v1/message/text", {
        chatGuid: CHAT_GUID,
        message: text,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      latestCtx?.ui.notify(`iMessage send failed: ${message}`, "warning");
    }
  }

  async function sendTypingIndicator() {
    try {
      await request("POST", `/api/v1/chat/${CHAT_GUID}/typing`);
    } catch {}
  }

  // ═══════════════════════════════════════
  // Poll for new messages
  // ═══════════════════════════════════════

  async function getLatestMessageTime(): Promise<number> {
    try {
      const res = (await request("POST", "/api/v1/message/query", {
        limit: 1,
        sort: "DESC",
      })) as BlueBubblesResponse;
      const msgs = res?.data || [];
      return msgs.length > 0 ? msgs[0].dateCreated || 0 : 0;
    } catch {
      setBridgeStatus("iMessage: disabled");
      return 0;
    }
  }

  async function pollMessages() {
    if (!enabled || !latestCtx) return;

    try {
      const res = (await request("POST", "/api/v1/message/query", {
        limit: 20,
        sort: "DESC",
        after: lastMessageTime,
        with: ["chat", "handle", "attachment"],
      })) as BlueBubblesResponse;

      const messages = (res?.data || []).reverse();
      setBridgeStatus("iMessage: active");

      for (const msg of messages) {
        const msgTime = msg.dateCreated || 0;
        if (msgTime <= lastMessageTime) continue;

        lastMessageTime = Math.max(lastMessageTime, msgTime);

        // Skip our own messages
        if (msg.isFromMe) continue;

        // Check it's from Matt
        const handle = msg.handle || {};
        const address = handle.address || "";
        const fromMatt = BB_PHONE && address.includes(BB_PHONE.replace("+", ""));
        if (!fromMatt) {
          const chats = Array.isArray(msg.chats) ? msg.chats : [];
          const chatMatch = chats.some((c) => (c.chatIdentifier || "").includes(BB_PHONE));
          if (!chatMatch) continue;
        }

        // Process the message
        await processMessage(msg);
      }
    } catch {
      setBridgeStatus("iMessage: polling error");
    }
  }

  async function processMessage(msg: BlueBubblesMessage) {
    const text = msg.text || "";
    const attachments = msg.attachments || [];

    const attachmentPaths: string[] = [];
    let voiceNotePath: string | null = null;

    for (const att of attachments) {
      const guid = att.guid || "";
      const mime = att.mimeType || "";
      if (!guid) continue;
      const result = await downloadAttachment(guid, mime);
      if (result) {
        attachmentPaths.push(result.path);
        if (result.isAudio) voiceNotePath = result.path;
      }
    }

    // Build the message content
    let fullMessage = text;
    if (voiceNotePath) {
      fullMessage = `[Voice note from Matt at ${voiceNotePath} — transcribe and respond]`;
      if (text) fullMessage += ` (caption: ${text})`;
    } else if (attachmentPaths.length > 0) {
      fullMessage += ` [Attachments: ${attachmentPaths.join(", ")}]`;
    }

    if (!fullMessage.trim()) return;

    setBridgeStatus("iMessage: received message");

    // Send typing indicator
    await sendTypingIndicator();

    // Inject as a real user message
    waitingForReply = true;

    // Build content array with images if applicable
    const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const imageAttachments = attachmentPaths.filter((p) => imageExts.some((ext) => p.toLowerCase().endsWith(ext)));

    if (imageAttachments.length > 0 && !voiceNotePath) {
      const content: Array<TextContentBlock | ImageContentBlock> = [];
      if (text) content.push({ type: "text", text: `[iMessage from Matt] ${text}` });
      for (const imgPath of imageAttachments) {
        try {
          const imgData = fs.readFileSync(imgPath);
          const ext = path.extname(imgPath).toLowerCase().replace(".", "");
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          content.push({
            type: "image",
            source: {
              type: "base64",
              mediaType,
              data: imgData.toString("base64"),
            },
          });
        } catch {}
      }
      pi.sendUserMessage(content, { deliverAs: "followUp" });
    } else {
      pi.sendUserMessage(`[iMessage from Matt] ${fullMessage}`, {
        deliverAs: "followUp",
      });
    }
  }

  // ═══════════════════════════════════════
  // Capture responses and send back
  // ═══════════════════════════════════════

  pi.on("turn_end", async (event, _ctx) => {
    if (!enabled || !waitingForReply) return;
    waitingForReply = false;

    // Extract the assistant's text response from the turn
    const message = event.message;
    if (!message) return;

    // Get text content from the message
    let responseText = "";
    if (typeof message.content === "string") {
      responseText = message.content;
    } else if (Array.isArray(message.content)) {
      responseText = message.content
        .filter(
          (b): b is TextContentBlock =>
            typeof b === "object" &&
            b !== null &&
            (b as { type?: unknown }).type === "text" &&
            typeof (b as { text?: unknown }).text === "string",
        )
        .map((b) => b.text)
        .join("\n");
    }

    if (!responseText.trim()) return;

    // Strip markdown for iMessage (keep it readable)
    const cleanText = responseText
      .replace(/```[\s\S]*?```/g, "[code block]") // collapse code blocks
      .replace(/`([^`]+)`/g, "$1") // inline code → plain
      .replace(/\*\*([^*]+)\*\*/g, "$1") // bold → plain
      .replace(/\*([^*]+)\*/g, "$1") // italic → plain
      .replace(/^#{1,6}\s+/gm, "") // strip headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
      .trim();

    // iMessage has a practical limit — split long messages
    const MAX_LEN = 4000;
    if (cleanText.length <= MAX_LEN) {
      await sendIMessage(cleanText);
    } else {
      // Split on paragraph boundaries
      const paragraphs = cleanText.split(/\n\n+/);
      let chunk = "";
      for (const para of paragraphs) {
        if (chunk.length + para.length + 2 > MAX_LEN) {
          if (chunk) await sendIMessage(chunk.trim());
          chunk = para;
        } else {
          chunk += (chunk ? "\n\n" : "") + para;
        }
      }
      if (chunk) await sendIMessage(chunk.trim());
    }
  });

  // ═══════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;

    // Check if BlueBubbles is reachable
    try {
      const res = (await request("GET", "/api/v1/ping")) as BlueBubblesResponse;
      if (res?.message === "pong") {
        enabled = true;
        setBridgeStatus("iMessage: active");

        // Start from current latest message
        lastMessageTime = await getLatestMessageTime();

        // Start polling
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollMessages, BB_POLL_INTERVAL);
      } else {
        setBridgeStatus("iMessage: disabled");
      }
    } catch {
      setBridgeStatus("iMessage: disabled");
    }
  });

  pi.on("session_shutdown", async () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    enabled = false;
    setBridgeStatus(undefined);
  });

  // ═══════════════════════════════════════
  // Commands
  // ═══════════════════════════════════════

  pi.registerCommand("imessage", {
    description: "Send an iMessage to Matt",
    args: [{ name: "message", description: "Message text", required: true }],
    execute: async (args, ctx) => {
      if (!enabled) {
        ctx.ui.notify("iMessage bridge not connected", "error");
        return;
      }
      const text = args.join(" ");
      await sendIMessage(text);
      ctx.ui.notify(`Sent iMessage: ${text.substring(0, 50)}...`, "info");
    },
  });

  pi.registerCommand("imessage-status", {
    description: "Check iMessage bridge status",
    execute: async (_args, ctx) => {
      ctx.ui.notify(
        enabled
          ? `iMessage bridge active. Polling every ${BB_POLL_INTERVAL / 1000}s. Last message time: ${lastMessageTime}`
          : "iMessage bridge disabled (BlueBubbles unreachable)",
        "info",
      );
    },
  });
}
