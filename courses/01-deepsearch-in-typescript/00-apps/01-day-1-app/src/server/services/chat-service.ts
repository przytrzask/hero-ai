import { Effect } from "effect";
import { streamText } from "ai";
import { model } from "~/models";
import type { Message } from "ai";

export const chatServiceImpl = {
  streamText: (messages: Message[]) =>
    Effect.try({
      try: () => streamText({ model, messages }),
      catch: (e) => e as Error,
    }),
};
