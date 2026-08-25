import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { createContext } from "./_core/context";
import { registerOAuthRoutes } from "./_core/oauth";
import { registerStorageProxy } from "./_core/storageProxy";
import { appRouter } from "./routers";
import { registerScheduledMonitoring } from "./scheduledMonitoring";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerScheduledMonitoring(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );
  return app;
}
