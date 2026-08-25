import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requestWindows = new Map<string, { count: number; resetAt: number }>();
const heatAnalysisLimit = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user)
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  const key = `heat-analysis:${ctx.user.id}`;
  const now = Date.now();
  const current = requestWindows.get(key);
  const window =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + 60_000 }
      : current;
  window.count += 1;
  requestWindows.set(key, window);
  if (window.count > 10)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many heat analyses. Try again in a minute.",
    });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const heatAnalysisProcedure = t.procedure
  .use(requireUser)
  .use(heatAnalysisLimit);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
