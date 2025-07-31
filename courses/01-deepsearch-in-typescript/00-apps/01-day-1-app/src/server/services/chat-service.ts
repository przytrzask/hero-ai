import { Effect, Data } from "effect";
import { streamText } from "ai";
import { z } from "zod";
import { model } from "~/models";
import { searchSerper } from "~/serper";
import type { Message } from "ai";

// ResponseMessage type from AI SDK
type ResponseMessage = {
  id: string;
  role: "assistant" | "tool";
  content: any;
  [key: string]: any;
};

// Chat service error
class ChatServiceError extends Data.TaggedError("ChatServiceError")<{
  operation: string;
  message: string;
}> {}

export const chatServiceImpl = {
  streamText: (
    messages: Message[],
    traceId?: string,
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
        [key: string]: any;
      };
    }) => void | Promise<void>,
  ) =>
    Effect.gen(function* () {
      const stream = yield* Effect.sync(() =>
        streamText({
          model,
          messages,
          maxSteps: 10,
          onFinish,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "agent",
            metadata: traceId ? { langfuseTraceId: traceId } : undefined,
          },
          system: `You are a helpful AI assistant with access to real-time web search capabilities.

When users ask questions that require current information, recent events, or specific facts that might have changed since your training data, you should use the searchWeb tool to find up-to-date information.

Use the searchWeb tool when:
- Users ask about recent news, events, or developments
- Questions require current data (stock prices, weather, sports scores, etc.)
- Users want to know about the latest trends or updates in any field
- You need to verify or find specific factual information
- Users ask about recent releases, updates, or announcements

When using search results:
- Always cite your sources by mentioning the websites or articles you found
- Summarize the information clearly and concisely
- If multiple sources have conflicting information, mention this
- Provide the most relevant and recent information available

Remember to be helpful, accurate, and transparent about when you're using web search to answer questions.`,
          tools: {
            searchWeb: {
              parameters: z.object({
                query: z.string().describe("The query to search the web for"),
              }),
              execute: async ({ query }, { abortSignal }) => {
                const results = await searchSerper(
                  { q: query, num: 10 },
                  abortSignal,
                );

                return results.organic.map((result) => ({
                  title: result.title,
                  link: result.link,
                  snippet: result.snippet,
                }));
              },
            },
          },
        }),
      );
      return stream;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new ChatServiceError({
            operation: "streamText",
            message: `Failed to create text stream: ${error}`,
          }),
        ),
      ),
    ),
};
