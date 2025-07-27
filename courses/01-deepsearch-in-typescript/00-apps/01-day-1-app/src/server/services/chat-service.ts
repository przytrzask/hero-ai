import { Effect } from "effect";
import { streamText } from "ai";
import { z } from "zod";
import { model } from "~/models";
import { searchSerper } from "~/serper";
import type { Message } from "ai";

export const chatServiceImpl = {
  streamText: (
    messages: Message[],
    onFinish?: (opts: {
      text: string;
      finishReason: string;
      usage: any;
      response: any;
    }) => void | Promise<void>,
  ) =>
    Effect.try({
      try: () =>
        streamText({
          model,
          messages,
          maxSteps: 10,
          onFinish,
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
      catch: (e) => e as Error,
    }),
};
