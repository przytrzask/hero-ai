import type { Message } from "ai";

export type MessagePart = NonNullable<Message["parts"]>[number];

export type NewChatCreatedData = {
  type: "NEW_CHAT_CREATED";
  chatId: string;
};

export function isNewChatCreated(data: unknown): data is NewChatCreatedData {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === "NEW_CHAT_CREATED" &&
    "chatId" in data &&
    typeof data.chatId === "string"
  );
}
