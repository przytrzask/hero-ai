import type { Message } from "ai";

export type MessagePart = NonNullable<Message["parts"]>[number];
