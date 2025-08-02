import { streamText, type Message } from "ai";
import { Effect } from "effect";
import { model } from "~/models";
import { ChatService, system, tools } from "~/server/services/chat-service";

// Utility function to remove thinking tags from AI responses
const stripThinkingTags = (text: string): string => {
  // Remove <thinking>...</thinking> blocks (including multiline)
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
};

const chatServiceImpl = {
  streamText: (messages: Message[]) =>
    Effect.gen(function* () {
      return streamText({
        model,
        messages,
        maxSteps: 3,
        tools: tools,
        system: system,
      });
    }),
};

export const askDeepSearch = (messages: Message[]) => {
  const effect = Effect.gen(function* () {
    const chat = yield* ChatService;
    const stream = yield* chat.streamText(messages);

    yield* Effect.tryPromise(() => stream.consumeStream());

    // Get the text and strip thinking tags
    const text = yield* Effect.succeed(stream.text);

    return text;
  });

  return Effect.runPromise(
    effect.pipe(Effect.provideService(ChatService, chatServiceImpl)),
  );
};
