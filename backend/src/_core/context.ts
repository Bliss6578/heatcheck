import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { clerkClient, getAuth } from "@clerk/express";
import type { User } from "../../drizzle/schema.js";
import * as db from "../db.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const { userId } = getAuth(opts.req);
    if (userId) {
      user = (await db.getUserByOpenId(userId)) ?? null;

      if (!user) {
        const clerkUser = await clerkClient.users.getUser(userId);
        const email = clerkUser.primaryEmailAddress?.emailAddress ?? null;
        const name = clerkUser.fullName ?? clerkUser.username ?? email;
        const loginMethod = clerkUser.externalAccounts[0]?.provider ?? "email";

        await db.upsertUser({
          openId: userId,
          name,
          email,
          loginMethod,
          lastSignedIn: new Date(),
        });
        user = (await db.getUserByOpenId(userId)) ?? null;
      }
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
