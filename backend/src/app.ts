import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clerkMiddleware } from "@clerk/express";
import { sql } from "drizzle-orm";
import express from "express";
import { createContext } from "./_core/context.js";
import { registerStorageProxy } from "./_core/storageProxy.js";
import { getDb } from "./db.js";
import { appRouter } from "./routers.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.use(clerkMiddleware({
    publishableKey:
      process.env.CLERK_PUBLISHABLE_KEY ??
      process.env.VITE_CLERK_PUBLISHABLE_KEY,
  }));
  app.get("/api/health", async (_req, res) => {
    const configured = Boolean(process.env.DATABASE_URL);

    try {
      const database = await getDb();
      if (!database) {
        res.status(503).json({
          ok: false,
          database: { configured, connected: false, schemaReady: false },
        });
        return;
      }

      await database.execute(sql`SELECT 1 FROM users LIMIT 1`);
      res.status(200).json({
        ok: true,
        database: { configured: true, connected: true, schemaReady: true },
      });
    } catch (error) {
      console.error("[Health] Database probe failed:", error);
      res.status(503).json({
        ok: false,
        database: { configured, connected: false, schemaReady: false },
      });
    }
  });
  registerStorageProxy(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );
  return app;
}
