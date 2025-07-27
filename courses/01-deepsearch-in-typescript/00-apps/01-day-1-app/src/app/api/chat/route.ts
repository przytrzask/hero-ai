import { Effect, Context, Data } from "effect";
import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  type StreamTextResult,
  appendResponseMessages,
} from "ai";

// ResponseMessage type from AI SDK
type ResponseMessage = {
  id: string;
  role: "assistant" | "tool";
  content: any;
  [key: string]: any;
};

class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
  message: string;
}> {}

class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{
  userId: string;
  message: string;
}> {}

class TooManyRequestsError extends Data.TaggedError("TooManyRequestsError")<{
  limit: number;
  message: string;
}> {}

class ParseRequestError extends Data.TaggedError("ParseRequestError")<{
  message: string;
}> {}

class SaveChatError extends Data.TaggedError("SaveChatError")<{
  operation: string;
  message: string;
}> {}
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
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    response: {
      messages: ResponseMessage[];
    };
  }) => void | Promise<void>,
) =>
  Effect.gen(function* () {
    const chat = yield* ChatService;
    const stream = yield* chat.streamText(messages, onFinish);
    return stream;
  });

const saveChatEffect = (
  userId: string,
  chatId: string,
  title: string,
  messages: Message[],
  responseMessages: ResponseMessage[],
) =>
  Effect.gen(function* () {
    const updatedMessages = appendResponseMessages({
      messages,
      responseMessages,
    });

    yield* Effect.tryPromise(() =>
      upsertChat({
        userId,
        chatId,
        title,
        messages: updatedMessages,
      }),
    );
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new SaveChatError({
          operation: "response save",
          message: `Failed to save chat response: ${error}`,
        }),
      ),
    ),
  );

const createChatEffect = (
  messages: Message[],
  userId: string,
  chatId: string,
  title: string,
) =>
  chatHandler(messages, async ({ response }) => {
    // Run the save effect but don't block the stream
    Effect.runPromise(
      saveChatEffect(userId, chatId, title, messages, response.messages),
    ).catch((error) => {
      console.error("Failed to save chat:", error);
    });
  }).pipe(Effect.provideService(ChatService, chatServiceImpl));

// Authentication Effect
const authenticateEffect = Effect.gen(function* () {
  const session = yield* Effect.tryPromise(() => auth());
  if (!session || !session.user?.id) {
    yield* Effect.fail(
      new UnauthorizedError({ message: "No valid session found" }),
    );
  }
  return session!.user!.id!; // Safe to assert since we checked above
}).pipe(
  Effect.catchAll(() =>
    Effect.fail(new UnauthorizedError({ message: "Authentication failed" })),
  ),
);

// User validation and rate limiting Effect
const validateUserEffect = (userId: string) =>
  Effect.gen(function* () {
    const user = yield* Effect.tryPromise(() => getUserById(userId));
    if (!user) {
      yield* Effect.fail(
        new UserNotFoundError({
          userId,
          message: `User with ID ${userId} not found`,
        }),
      );
    }

    // Check rate limit (skip for admin users)
    if (!user!.isAdmin) {
      const dailyRequestCount = yield* Effect.tryPromise(() =>
        getDailyRequestCount(userId),
      );
      if (dailyRequestCount >= DAILY_REQUEST_LIMIT) {
        yield* Effect.fail(
          new TooManyRequestsError({
            limit: DAILY_REQUEST_LIMIT,
            message: `Daily limit of ${DAILY_REQUEST_LIMIT} requests exceeded`,
          }),
        );
      }
    }

    // Add request to database
    yield* Effect.tryPromise(() => addRequest(userId));

    return user!;
  });

// Parse request body Effect
const parseRequestEffect = (request: Request) =>
  Effect.gen(function* () {
    const rawBody = yield* Effect.tryPromise(() => request.json());

    const body = rawBody as {
      messages: Array<Message>;
      chatId: string;
      isNewChat: boolean;
    };

    const { messages, chatId, isNewChat } = body;
    const firstUserMessage = messages.find((m: Message) => m.role === "user");
    const chatTitle = firstUserMessage?.content?.substring(0, 50) || "New Chat";

    return {
      messages,
      chatId,
      chatTitle,
      isNewChat,
    };
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new ParseRequestError({ message: `Failed to parse request: ${error}` }),
      ),
    ),
  );

// Initial chat save Effect
const saveInitialChatEffect = (
  userId: string,
  chatId: string,
  title: string,
  messages: Message[],
) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() =>
      upsertChat({
        userId,
        chatId,
        title,
        messages,
      }),
    );
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new SaveChatError({
          operation: "initial save",
          message: `Failed to save initial chat: ${error}`,
        }),
      ),
    ),
  );

// Main Effect pipeline
const handleChatRequestEffect = (request: Request) =>
  Effect.gen(function* () {
    const userId = yield* authenticateEffect;
    const user = yield* validateUserEffect(userId);
    const { messages, chatId, chatTitle, isNewChat } =
      yield* parseRequestEffect(request);

    // Save initial chat to protect against broken streams
    yield* saveInitialChatEffect(userId, chatId, chatTitle, messages);

    const chatEffect = createChatEffect(messages, userId, chatId, chatTitle);

    return {
      chatEffect,
      isNewChat,
      chatId,
    };
  });

export async function POST(request: Request) {
  const result = await Effect.runPromise(
    handleChatRequestEffect(request).pipe(
      Effect.catchTags({
        UnauthorizedError: (error) => {
          console.error("Authorization failed:", error.message);
          return Effect.succeed(new Response("Unauthorized", { status: 401 }));
        },
        UserNotFoundError: (error) => {
          console.error(
            "User not found:",
            error.message,
            "UserId:",
            error.userId,
          );
          return Effect.succeed(
            new Response("User not found", { status: 404 }),
          );
        },
        TooManyRequestsError: (error) => {
          console.error(
            "Rate limit exceeded:",
            error.message,
            "Limit:",
            error.limit,
          );
          return Effect.succeed(
            new Response("Too Many Requests", { status: 429 }),
          );
        },
        ParseRequestError: (error) => {
          console.error("Parse error:", error.message);
          return Effect.succeed(new Response("Bad Request", { status: 400 }));
        },
        SaveChatError: (error) => {
          console.error("Chat save error:", error.operation, error.message);
          return Effect.succeed(
            new Response("Internal Server Error", { status: 500 }),
          );
        },
      }),
      Effect.catchAll((error) => {
        console.error("Unexpected error:", error);
        return Effect.succeed(
          new Response("Internal Server Error", { status: 500 }),
        );
      }),
    ),
  );

  // If result is a Response, return it (error case)
  if (result instanceof Response) {
    return result;
  }

  // Success case - return streaming response
  const { chatEffect, isNewChat, chatId } = result;

  return createDataStreamResponse({
    execute: async (dataStream) => {
      // Send new chat ID to frontend if this is a new chat
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId,
        });
      }

      const stream = await Effect.runPromise(chatEffect);
      stream.mergeIntoDataStream(dataStream);
    },

    onError: (e) => {
      console.error("Streaming error:", e);
      return "Oops, an error occurred during streaming!";
    },
  });
}
