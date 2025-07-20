import { eq, and, gte, sql } from "drizzle-orm";
import { db } from "./index";
import { users, requests } from "./schema";
import type { DB } from "./schema";

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
