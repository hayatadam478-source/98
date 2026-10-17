import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateSessionCheckBody,
  CreateSessionCheckResponse,
  GetSessionCheckParams,
  GetSessionCheckResponse,
} from "@workspace/api-zod";
import {
  createSessionCheckService,
  type SessionCheckRunner,
} from "../lib/session-check-service";

interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
}

export interface SessionCheckRouterOptions {
  getServiceToken?: () => string | undefined;
  runSessionCheck?: SessionCheckRunner;
  rateLimit?: RateLimitOptions;
}

interface Bucket {
  startedAt: number;
  count: number;
}

function validServiceToken(token: string | undefined): token is string {
  return typeof token === "string" && Buffer.byteLength(token) >= 32 && !/\s/.test(token);
}

function matchesBearerToken(header: string | undefined, expectedToken: string): boolean {
  if (!header) return false;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return false;
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sendApiError(
  response: Parameters<RequestHandler>[1],
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ error: { code, message } });
}

function createRateLimitMiddleware({
  limit = 30,
  windowMs = 60_000,
}: RateLimitOptions = {}): RequestHandler {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new TypeError("Rate-limit settings must be positive values.");
  }

  const buckets = new Map<string, Bucket>();
  return (request, response, next): void => {
    const currentTime = Date.now();
    const key = request.ip || request.socket.remoteAddress || "unknown";
    let bucket = buckets.get(key);
    if (!bucket || currentTime - bucket.startedAt >= windowMs) {
      bucket = { startedAt: currentTime, count: 0 };
      buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil((bucket.startedAt + windowMs - currentTime) / 1_000),
      );
      response.setHeader("Retry-After", String(retryAfter));
      sendApiError(response, 429, "rate_limited", "Too many requests. Retry later.");
      return;
    }

    bucket.count += 1;
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (currentTime - value.startedAt >= windowMs) buckets.delete(bucketKey);
      }
    }
    next();
  };
}

function createAuthenticationMiddleware(
  getServiceToken: () => string | undefined,
): RequestHandler {
  return (request, response, next): void => {
    const expectedToken = getServiceToken();
    if (!validServiceToken(expectedToken)) {
      sendApiError(
        response,
        503,
        "service_not_configured",
        "The service authentication token is not configured.",
      );
      return;
    }

    if (!matchesBearerToken(request.get("authorization"), expectedToken)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="fairfare-api"');
      sendApiError(response, 401, "unauthorized", "A valid bearer token is required.");
      return;
    }
    next();
  };
}

export function createSessionCheckRouter({
  getServiceToken = () => process.env.WORKER_SERVICE_TOKEN?.trim(),
  runSessionCheck,
  rateLimit,
}: SessionCheckRouterOptions = {}): IRouter {
  const router: IRouter = Router();
  const jobs = createSessionCheckService({ runSessionCheck });

  router.use("/v1", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  router.use("/v1", createRateLimitMiddleware(rateLimit));
  router.use("/v1", createAuthenticationMiddleware(getServiceToken));

  router.post("/v1/session-check", (request, response): void => {
    const hasBody =
      Number(request.get("content-length") ?? 0) > 0 ||
      Boolean(request.get("transfer-encoding"));
    if (hasBody && !request.is("application/json")) {
      sendApiError(response, 415, "unsupported_media_type", "Use application/json.");
      return;
    }

    const body = CreateSessionCheckBody.strict().safeParse(request.body ?? {});
    if (!body.success) {
      sendApiError(
        response,
        400,
        "invalid_request",
        "This endpoint accepts an empty JSON object; no input fields are supported.",
      );
      return;
    }

    const result = jobs.create();
    if ("error" in result) {
      if (result.error === "context_busy") {
        sendApiError(
          response,
          409,
          "context_busy",
          "A session-check job is already using the shared context. Retry later.",
        );
        return;
      }
      sendApiError(response, 503, "job_store_full", "The in-memory job store is full.");
      return;
    }

    response.status(202).json(CreateSessionCheckResponse.parse(result.job));
  });

  router.get("/v1/session-check/:jobId", (request, response): void => {
    const params = GetSessionCheckParams.safeParse(request.params);
    if (!params.success) {
      sendApiError(response, 400, "invalid_job_id", "Job ID is invalid.");
      return;
    }

    const job = jobs.get(params.data.jobId);
    if (!job) {
      sendApiError(response, 404, "job_not_found", "Session-check job was not found.");
      return;
    }
    response.json(GetSessionCheckResponse.parse(job));
  });

  router.all("/v1/session-check", (_request, response): void => {
    response.setHeader("Allow", "POST");
    sendApiError(response, 405, "method_not_allowed", "Use POST.");
  });
  router.all("/v1/session-check/:jobId", (_request, response): void => {
    response.setHeader("Allow", "GET");
    sendApiError(response, 405, "method_not_allowed", "Use GET.");
  });
  router.use("/v1", (_request, response): void => {
    sendApiError(response, 404, "not_found", "Route not found.");
  });

  return router;
}
