import { Effect, Context } from "effect";
import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  type StreamTextResult,
} from "ai";
import { auth } from "~/server/auth";
import { chatServiceImpl } from "~/server/services/chat-service";
import {
  getUserById,
  getDailyRequestCount,
  addRequest,
} from "~/server/db/queries";

export const maxDuration = 60;

// Rate limit: 50 requests per day for non-admin users
const DAILY_REQUEST_LIMIT = 50;

class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    streamText: (
      messages: Message[],
    ) => Effect.Effect<StreamTextResult<any, any>, Error>;
  }
>() {}

const chatHandler = (messages: Message[]) =>
  Effect.gen(function* () {
    const chat = yield* ChatService;
    const stream = yield* chat.streamText(messages);
    return stream;
  });

export async function POST(request: Request) {
  // Check authentication
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  if (!userId) {
    return new Response("User ID not found", { status: 400 });
  }

  // Get user information to check admin status
  const user = await getUserById(userId);
  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  // Check rate limit (skip for admin users)
  if (!user.isAdmin) {
    const dailyRequestCount = await getDailyRequestCount(userId);
    if (dailyRequestCount >= DAILY_REQUEST_LIMIT) {
      return new Response("Too Many Requests", { status: 429 });
    }
  }

  // Add request to database
  await addRequest(userId);

  const body = (await request.json()) as {
    messages: Array<Message>;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const runnable = chatHandler(body.messages).pipe(
        Effect.provideService(ChatService, chatServiceImpl),
      );
      const stream = await Effect.runPromise(runnable);
      stream.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });
}
