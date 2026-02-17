import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.js";

const TTL_MS = 60 * 60 * 1000; // 60 minutes
const MAX_MESSAGES = 20;

interface ConversationEntry {
  messages: MessageParam[];
  lastActivity: number;
}

const conversations = new Map<string, ConversationEntry>();

function evictStale(): void {
  const now = Date.now();
  for (const [phone, entry] of conversations) {
    if (now - entry.lastActivity > TTL_MS) {
      conversations.delete(phone);
    }
  }
}

export function getHistory(phone: string): MessageParam[] {
  evictStale();
  return conversations.get(phone)?.messages ?? [];
}

export function addMessage(
  phone: string,
  role: "user" | "assistant",
  content: string
): void {
  let entry = conversations.get(phone);
  if (!entry) {
    entry = { messages: [], lastActivity: Date.now() };
    conversations.set(phone, entry);
  }

  entry.messages.push({ role, content });
  entry.lastActivity = Date.now();

  // Keep only the last MAX_MESSAGES
  if (entry.messages.length > MAX_MESSAGES) {
    entry.messages = entry.messages.slice(-MAX_MESSAGES);
  }
}
