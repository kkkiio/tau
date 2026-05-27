import { MAX_IMAGE_DIM, VALID_IMAGE_MIME_TYPES } from "./constants";
import type { ChatItem, PiMessage, PromptImage, Usage } from "./types";

export function syncToItems(
  entries: Array<{ type: string; message?: PiMessage }>,
  nextId: (prefix: string) => string,
): ChatItem[] {
  const items: ChatItem[] = [];
  const tools = new Map<string, ChatItem & { kind: "tool" }>();

  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;

    if (message.role === "user") {
      const text = extractText(message.content);
      const images = extractImages(message.content);
      if (text || images.length > 0) {
        items.push({
          kind: "message",
          id: message.id || nextId("user"),
          role: "user",
          text,
          images,
        });
      }
    } else if (message.role === "assistant") {
      const text = extractText(message.content);
      const reasoning = extractThinking(message.content);
      const toolCalls = extractToolCalls(message.content);
      if (text || reasoning) {
        items.push({
          kind: "message",
          id: message.id || nextId("assistant"),
          role: "assistant",
          text,
          reasoning,
          copyable: toolCalls.length === 0,
          presentation: toolCalls.length > 0 ? "activity" : "normal",
          cost: message.usage?.cost?.total,
        });
      }

      for (const call of toolCalls) {
        const tool: ChatItem & { kind: "tool" } = {
          kind: "tool",
          id: call.id || nextId("tool"),
          name: call.name || "tool",
          input: call.arguments,
          state: "input-available",
        };
        tools.set(tool.id, tool);
        items.push(tool);
      }
    } else if (message.role === "toolResult" && message.toolCallId) {
      const tool = tools.get(message.toolCallId);
      if (tool) {
        if (message.isError) {
          tool.state = "output-error";
          tool.errorText = formatToolOutput(message.content);
        } else {
          tool.state = "output-available";
          tool.output = formatToolOutput(message.content);
        }
      }
    }
  }

  return items;
}

export function extractText(content: PiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block): block is { type: "text"; text?: string } => block.type === "text")
    .map((block) => block.text || "")
    .filter(Boolean)
    .join("\n");
}

export function extractThinking(content: PiMessage["content"]): string {
  if (!Array.isArray(content)) return "";

  return content
    .filter((block): block is { type: "thinking"; thinking?: string } => block.type === "thinking")
    .map((block) => block.thinking || "")
    .filter(Boolean)
    .join("\n");
}

export function extractImages(content: PiMessage["content"]): PromptImage[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (
        block,
      ): block is {
        type: "image";
        data?: string;
        mimeType?: string;
        source?: { data?: string; media_type?: string };
      } => block.type === "image",
    )
    .map((block) => ({
      data: block.source?.data || block.data || "",
      mimeType: block.source?.media_type || block.mimeType || "image/png",
    }))
    .filter((image) => image.data);
}

export function extractToolCalls(content: PiMessage["content"]) {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (
      block,
    ): block is {
      type: "toolCall";
      id?: string;
      name?: string;
      arguments?: unknown;
    } => block.type === "toolCall",
  );
}

export function findLastUsage(entries: Array<{ type: string; message?: PiMessage }>): Usage | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const usage = entries[i].message?.usage;
    if (usage) return usage;
  }
  return null;
}

export async function processPromptFiles(files: unknown[] | undefined): Promise<PromptImage[]> {
  if (!files?.length) return [];
  const images: PromptImage[] = [];
  for (const filePart of files) {
    const file = filePart instanceof File ? filePart : getFileFromPart(filePart);
    if (!file) {
      const converted = getImageFromFilePart(filePart);
      if (converted) images.push(converted);
      continue;
    }
    if (!file.type.startsWith("image/")) continue;
    try {
      images.push(await processImageFile(file));
    } catch (err) {
      console.error("[Tau] Image processing failed:", err);
    }
  }
  return images;
}

function getFileFromPart(part: unknown): File | null {
  if (typeof part !== "object" || part === null) return null;
  const maybeFile = (part as { file?: unknown }).file;
  return maybeFile instanceof File ? maybeFile : null;
}

function getImageFromFilePart(part: unknown): PromptImage | null {
  if (typeof part !== "object" || part === null) return null;
  const value = part as { mediaType?: string; mimeType?: string; url?: string };
  const mimeType = value.mediaType || value.mimeType || "";
  if (!mimeType.startsWith("image/") || !value.url?.startsWith("data:")) return null;
  const [, data = ""] = value.url.split(",");
  return data ? { data, mimeType } : null;
}

function processImageFile(file: File): Promise<PromptImage> {
  return new Promise((resolve, reject) => {
    const mimeType = VALID_IMAGE_MIME_TYPES.includes(file.type) ? file.type : "image/png";
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
          const scale = MAX_IMAGE_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to create canvas"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const outputMime = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
        const dataUrl = canvas.toDataURL(outputMime, outputMime === "image/jpeg" ? 0.85 : undefined);
        const base64 = dataUrl.split(",")[1];
        if (!base64) {
          reject(new Error("Failed to encode image"));
          return;
        }
        resolve({ data: base64, mimeType: outputMime });
      };
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function formatToolOutput(result: unknown): string {
  if (!result) return "";

  if (Array.isArray(result)) {
    return result.map((block) => (isTextBlock(block) ? block.text || "" : JSON.stringify(block, null, 2))).join("\n");
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    return formatToolOutput((result as { content: unknown[] }).content);
  }

  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

function isTextBlock(value: unknown): value is { type: "text"; text?: string } {
  return (
    typeof value === "object" && value !== null && "type" in value && (value as { type?: unknown }).type === "text"
  );
}
