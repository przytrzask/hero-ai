import { Effect, Context } from "effect";
import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  type StreamTextResult,
  appendResponseMessages,
} from "ai";
import { auth } from "~/server/auth";
import { chatServiceImpl } from "~/server/services/chat-service";
import {
  getUserById,
  getDailyRequestCount,
  addRequest,
  upsertChat,
} from "~/server/db/queries";

export const maxDuration = 60;

// Rate limit: 50 requests per day for non-admin users
const DAILY_REQUEST_LIMIT = 5;

class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    streamText: (
      messages: Message[],
      onFinish?: (opts: {
        text: string;
        finishReason: string;
        usage: any;
        response: any;
      }) => void | Promise<void>,
    ) => Effect.Effect<StreamTextResult<any, any>, Error>;
  }
>() {}

const chatHandler = (
  messages: Message[],
  onFinish?: (opts: {
    text: string;
    finishReason: string;
    usage: any;
    response: any;
  }) => void | Promise<void>,
) =>
  Effect.gen(function* () {
    const chat = yield* ChatService;
    const stream = yield* chat.streamText(messages, onFinish);
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
    chatId?: string;
  };

  const { messages, chatId } = body;

  // Generate chatId if not provided
  const isNewChat = !chatId;
  const finalChatId = chatId || crypto.randomUUID();

  // Create chat title from first user message (fallback to "New Chat")
  const firstUserMessage = messages.find((m) => m.role === "user");
  const chatTitle = firstUserMessage?.content?.substring(0, 50) || "New Chat";

  // Create chat immediately to protect against broken streams

  console.log({ chatId, isNewChat });
  await upsertChat({
    userId,
    chatId: finalChatId,
    title: chatTitle,
    messages,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // Send new chat ID to frontend if this is a new chat
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: finalChatId,
        });
      }

      const runnable = chatHandler(messages, async ({ response }) => {
        try {
          // Get the response messages from the AI
          const responseMessages = response.messages;

          // Merge the original messages with the response messages
          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages,
          });

          // Save the complete conversation to the database
          await upsertChat({
            userId,
            chatId: finalChatId,
            title: chatTitle,
            messages: updatedMessages,
          });
        } catch (error) {
          console.error("Failed to save chat:", error);
        }
      }).pipe(Effect.provideService(ChatService, chatServiceImpl));
      const stream = await Effect.runPromise(runnable);
      stream.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });
}
