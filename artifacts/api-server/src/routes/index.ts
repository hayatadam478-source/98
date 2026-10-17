import { Router, type IRouter } from "express";
import healthRouter from "./health";
import {
  createSessionCheckRouter,
  type SessionCheckRouterOptions,
} from "./session-check";

export interface ApiRouterOptions {
  sessionCheck?: SessionCheckRouterOptions;
}

export function createApiRouter({ sessionCheck }: ApiRouterOptions = {}): IRouter {
  const router: IRouter = Router();
  router.use(healthRouter);
  router.use(createSessionCheckRouter(sessionCheck));
  return router;
}

const router = createApiRouter();

export default router;
