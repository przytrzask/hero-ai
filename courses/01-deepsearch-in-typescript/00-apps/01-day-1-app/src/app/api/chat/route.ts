import { Effect, Context } from "effect";
import type { Message } from "ai";
import { streamText, createDataStreamResponse } from "ai";
import { chatServiceImpl } from "~/server/services/chat-service";

export const maxDuration = 60;

class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    streamText: (
      messages: Message[],
    ) => Effect.Effect<ReturnType<typeof streamText>, Error>;
  }
>() {}

const chatHandler = (messages: Message[]) =>
  Effect.gen(function* () {
    const chat = yield* ChatService;
    const stream = yield* chat.streamText(messages);
    return stream;
  });

export async function POST(request: Request) {
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
