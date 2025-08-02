import { evalite } from "evalite";
import type { Message } from "ai";
import { askDeepSearch } from "./askDeepSearch";

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: Message[] }[]> => {
    return [
      {
        input: [
          {
            id: "1",
            role: "user",
            content: "What is the latest version of TypeScript?",
          },
        ],
      },
      {
        input: [
          {
            id: "2",
            role: "user",
            content: "What are the main features of Next.js 15?",
          },
        ],
      },
    ];
  },
  task: async (input) => {
    return askDeepSearch(input);
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        console.log(output);

        // Regex to match markdown links: [text](url)
        const markdownLinkRegex = /\[.*?\]\(.*?\)/g;
        const containsLinks = markdownLinkRegex.test(output);

        return containsLinks ? 1 : 0;
      },
    },
  ],
});
