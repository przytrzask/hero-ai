import { eq, and, gte, sql, desc } from "drizzle-orm";
import { db } from "./index";
import { users, requests, chats, messages } from "./schema";
import type { DB } from "./schema";
import type { Message } from "ai";

export const getUserById = async (id: string): Promise<DB.User | null> => {
  const user = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user[0] || null;
};

export const getDailyRequestCount = async (userId: string): Promise<number> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(requests)
    .where(and(eq(requests.userId, userId), gte(requests.timestamp, today)));

  return result[0]?.count || 0;
};

export const addRequest = async (userId: string): Promise<DB.Request> => {
  const newRequest = await db.insert(requests).values({ userId }).returning();

  if (!newRequest[0]) {
    throw new Error("Failed to insert request");
  }

  return newRequest[0];
};

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: Message[];
}) => {
  const { userId, chatId, title, messages: messageList } = opts;

  return await db.transaction(async (tx) => {
    // Check if chat exists and belongs to this user
    const existingChat = await db.query.chats.findFirst({
      where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    });

    // Check if any chat exists with this ID (for security)
    const anyChat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
    });

    // If chat exists but doesn't belong to user, throw error
    if (anyChat && !existingChat) {
      throw new Error("Chat does not belong to the logged in user");
    }

    // Upsert the chat using Drizzle's built-in functionality
    await tx
      .insert(chats)
      .values({
        id: chatId,
        userId,
        title,
      })
      .onConflictDoUpdate({
        target: chats.id,
        set: {
          title,
          updatedAt: new Date(),
        },
      });

    // Delete all existing messages for this chat
    await tx.delete(messages).where(eq(messages.chatId, chatId));

    // Insert all new messages
    if (messageList.length > 0) {
      const messageInserts = messageList.map((message, index) => ({
        chatId,
        role: message.role,
        parts: message.parts,
        order: index,
      }));

      await tx.insert(messages).values(messageInserts);
    }

    return chatId;
  });
};

export const getChat = async (opts: { userId: string; chatId: string }) => {
  const { userId, chatId } = opts;

  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    with: {
      messages: {
        orderBy: (messages, { asc }) => [asc(messages.order)],
      },
    },
  });

  if (!chat) {
    return null;
  }

  return {
    ...chat,
    messages: chat.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.parts,
    })),
  };
};

export const getChats = async (opts: {
  userId: string;
}): Promise<DB.Chat[]> => {
  const { userId } = opts;

  return await db.query.chats.findMany({
    where: eq(chats.userId, userId),
    orderBy: (chats, { desc }) => [desc(chats.updatedAt)],
  });
};
