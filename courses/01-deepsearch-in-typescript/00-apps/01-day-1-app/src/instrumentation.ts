import { env } from "./env";

import { registerOTel } from "@vercel/otel";
import { LangfuseExporter } from "langfuse-vercel";

export function register() {
  registerOTel({
    serviceName: "ai-hero",
    traceExporter: new LangfuseExporter({
      environment: env.NODE_ENV,
    }),
  });
}
