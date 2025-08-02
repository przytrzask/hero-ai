import { redis } from "~/server/redis/redis";
import { Context, Data, Effect, Layer } from "effect";
import type Redis from "ioredis";

export class RedisError extends Data.TaggedError("RedisError")<{
  cause?: unknown;
  message?: string;
}> {}

interface RedisImpl {
  use: <T>(
    fn: (client: Redis) => T,
  ) => Effect.Effect<Awaited<T>, RedisError, never>;
}

interface RateLimitConfigImpl {
  maxRequests: number;
  windowMs: number;
  maxRetries: number;
}

export class RedisService extends Context.Tag("Redis")<
  RedisService,
  RedisImpl
>() {}

export class RateLimitConfig extends Context.Tag("RedisConfig")<
  RateLimitConfig,
  RateLimitConfigImpl
>() {}

export const recordRateLimit = () =>
  Effect.gen(function* () {
    const rateLimitConfig = yield* RateLimitConfig;
    const redis = yield* RedisService;

    const now = Date.now();
    const windowStart =
      Math.floor(now / rateLimitConfig.windowMs) * rateLimitConfig.windowMs;
    const key = `rate_limit:${windowStart}`;

    const pipeline = yield* redis.use((client) => client.pipeline());
    pipeline.incr(key);
    pipeline.expire(key, Math.ceil(rateLimitConfig.windowMs / 1000));

    const results = yield* Effect.tryPromise(() => pipeline.exec());

    const currentCount = results?.[0]?.[1] as number;

    return {
      allowed: currentCount <= rateLimitConfig.maxRequests,
    };
  });

export const checkRateLimit = ({
  maxRequests,
  windowMs,
}: Pick<RateLimitConfigImpl, "maxRequests" | "windowMs">) =>
  Effect.gen(function* () {
    const redis = yield* RedisService;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const key = `rate_limit:${windowStart}`;

    const currentCount = yield* redis.use((client) => client.get(key));
    const count = currentCount ? parseInt(currentCount, 10) : 0;

    const allowed = count < maxRequests;
    const remaining = Math.max(0, maxRequests - count);
    const resetTime = windowStart + windowMs;
    const retryAfter = Math.max(0, resetTime - now);

    return {
      allowed,
      remaining,
      resetTime,
      totalHits: count,
      retryAfter,
    };
  });

export const RateLimitConfigLive = Layer.succeed(RateLimitConfig, {
  maxRequests: 3,
  windowMs: 120_000,
  maxRetries: 2,
});

const makeRedisClient = (redis: Redis) => ({
  use: <T>(fn: (client: Redis) => T) =>
    Effect.tryPromise({
      try: () => Promise.resolve(fn(redis)),
      catch: (cause) =>
        new RedisError({ cause, message: "Redis operation failed" }),
    }),
});

export const LayerRedis = Layer.succeed(RedisService, makeRedisClient(redis));

export const RedisLive = Layer.mergeAll(LayerRedis, RateLimitConfigLive);
