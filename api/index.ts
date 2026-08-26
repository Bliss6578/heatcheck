import "dotenv/config";
import type { Request, Response } from "express";
import { createApp } from "../backend/src/app";

const app = createApp();

/**
 * Vercel invokes this single function for every /api/* request. The rewrite
 * stores the public path in __path; restore it before Express handles it.
 */
export default function handler(req: Request, res: Response) {
  const requestUrl = new URL(req.url, "http://localhost");
  const apiPath = requestUrl.searchParams.get("__path") ?? "";

  requestUrl.pathname = `/api/${apiPath}`;
  requestUrl.searchParams.delete("__path");
  req.url = `${requestUrl.pathname}${requestUrl.search}`;

  return app(req, res);
}
