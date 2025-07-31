import { Effect, Data } from "effect";
import { streamText } from "ai";
import { z } from "zod";
import { model } from "~/models";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/scraper";
import { cacheWithRedis } from "~/server/redis/redis";
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

// Cached scraper function
const cachedScrapePages = cacheWithRedis(
  "scrapePages",
  async (urls: string[]) => {
    return await bulkCrawlWebsites({ urls });
  },
);

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
          system: `You are a helpful AI assistant with access to real-time web search and web scraping capabilities.

When users ask questions that require current information, recent events, or specific facts that might have changed since your training data, you should use the searchWeb tool to find up-to-date information.

Use the searchWeb tool when:
- Users ask about recent news, events, or developments
- Questions require current data (stock prices, weather, sports scores, etc.)
- Users want to know about the latest trends or updates in any field
- You need to verify or find specific factual information
- Users ask about recent releases, updates, or announcements

Use the scrapePages tool when:
- You need to get the full content of specific web pages found through search
- Search snippets don't provide enough detail to answer the user's question
- You need to extract detailed information from articles, blog posts, or documentation
- The user asks for comprehensive analysis of specific web pages
- You need to access content that may not be fully represented in search snippets

When using search results:
- Always cite your sources by mentioning the websites or articles you found
- Summarize the information clearly and concisely
- If multiple sources have conflicting information, mention this
- Provide the most relevant and recent information available

When scraping pages:
- Only scrape pages that are directly relevant to the user's question
- Be respectful of robots.txt and website policies
- Provide clear attribution to the source websites
- Summarize the scraped content rather than dumping all raw text

Remember to be helpful, accurate, and transparent about when you're using web search and scraping to answer questions.`,
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
            scrapePages: {
              parameters: z.object({
                urls: z
                  .array(z.string().url())
                  .describe("Array of URLs to scrape for full content"),
              }),
              execute: async ({ urls }) => {
                const result = await cachedScrapePages(urls);

                if (result.success) {
                  return result.results.map((r) => ({
                    url: r.url,
                    success: r.result.success,
                    content: r.result.success ? r.result.data : undefined,
                    error: !r.result.success
                      ? (r.result as any).error
                      : undefined,
                  }));
                } else {
                  return {
                    success: false,
                    error: result.error,
                    results: result.results.map((r) => ({
                      url: r.url,
                      success: r.result.success,
                      content: r.result.success ? r.result.data : undefined,
                      error: !r.result.success
                        ? (r.result as any).error
                        : undefined,
                    })),
                  };
                }
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
