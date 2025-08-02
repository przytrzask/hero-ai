import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    setupFiles: ["dotenv/config"],
    // Increase timeout for deep search operations (web search + LLM calls)
    testTimeout: 120000, // 2 minutes in milliseconds
  },
  plugins: [tsconfigPaths()],
});
