import { Effect, Data, Context } from "effect";
import { streamText } from "ai";
import { z } from "zod";
import { model } from "~/models";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/scraper";
import { cacheWithRedis } from "~/server/redis/redis";
import type { Message, StreamTextResult, ToolSet } from "ai";

export const system = `You are a helpful AI assistant with access to real-time web search capabilities. 
The current date and time is ${new Date().toLocaleString()}. When answering questions:

1. Always search the web for up-to-date information when relevant
2. ALWAYS format URLs as markdown links using the format [title](url)
3. Be thorough but concise in your responses
4. If you're unsure about something, search the web to verify
5. When providing information, always include the source where you found it using markdown links
6. Never include raw URLs - always use markdown link format
7. When users ask for up-to-date information, use the current date to provide context about how recent the information is
8. IMPORTANT: After finding relevant URLs from search results, ALWAYS use the scrapePages tool to get the full content of those pages. Never rely solely on search snippets.

Your workflow should be:
1. Use searchWeb to find 5 relevant URLs from diverse sources (news sites, blogs, official documentation, etc.)
2. Select 4-6 of the most relevant and diverse URLs to scrape
3. Use scrapePages to get the full content of those URLs
4. Use the full content to provide detailed, accurate answers

Remember to:
- Always scrape multiple sources (4-6 URLs) for each query
- Choose diverse sources (e.g., not just news sites or just blogs)
- Prioritize official sources and authoritative websites
- Use the full content to provide comprehensive answers`;

export const tools: ToolSet = {
  searchWeb: {
    parameters: z.object({
      query: z.string().describe("The query to search the web for"),
    }),
    execute: async ({ query }, { abortSignal }) => {
      const results = await searchSerper({ q: query, num: 10 }, abortSignal);

      return results.organic.map((result) => ({
        title: result.title,
        link: result.link,
        snippet: result.snippet,
        date: result.date,
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
          error: !r.result.success ? (r.result as any).error : undefined,
        }));
      } else {
        return {
          success: false,
          error: result.error,
          results: result.results.map((r) => ({
            url: r.url,
            success: r.result.success,
            content: r.result.success ? r.result.data : undefined,
            error: !r.result.success ? (r.result as any).error : undefined,
          })),
        };
      }
    },
  },
};

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
          system,
          tools,
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

export class ChatService extends Context.Tag("ChatService")<
  ChatService,
  {
    streamText: (
      messages: Message[],
      traceId?: string,
      onFinish?: Parameters<typeof streamText>[0]["onFinish"],
    ) => Effect.Effect<StreamTextResult<any, any>, Error>;
  }
>() {}
