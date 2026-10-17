import express, {
  type ErrorRequestHandler,
  type Express,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { createApiRouter, type ApiRouterOptions } from "./routes";
import { logger } from "./lib/logger";

export function createApp(options: ApiRouterOptions = {}): Express {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors());
  app.use(express.json({ limit: "2kb" }));
  app.use(express.urlencoded({ extended: true, limit: "2kb" }));

  app.use("/api", createApiRouter(options));

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: "not_found", message: "Route not found." },
    });
  });

  const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const errorType =
      error && typeof error === "object" && "type" in error
        ? String(error.type)
        : "";
    if (errorType === "entity.parse.failed") {
      request.log.warn({ code: "invalid_json" }, "Request rejected");
      response.status(400).json({
        error: { code: "invalid_json", message: "Request body must be valid JSON." },
      });
      return;
    }
    if (errorType === "entity.too.large") {
      request.log.warn({ code: "payload_too_large" }, "Request rejected");
      response.status(413).json({
        error: { code: "payload_too_large", message: "Request body is too large." },
      });
      return;
    }

    request.log.error({ err: error }, "Unhandled API request failure");
    response.status(500).json({
      error: { code: "internal_error", message: "The request could not be completed." },
    });
  };
  app.use(errorHandler);

  return app;
}

const app = createApp();
export default app;
