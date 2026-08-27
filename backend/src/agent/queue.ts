import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { autonomousAgentRuns } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { requireLocationMember, requireOperatorRole, requireWorkspaceMember } from "../heatcheck/tenant.js";
import type { AgentGoal } from "./types.js";
import { runAutonomousAgent } from "./orchestrator/run-agent.js";

async function requireQueueDb() { const db = await getDb(); if (!db) throw new Error("HeatCheck queue is unavailable."); return db; }

export async function enqueueAutonomousAgentRun(input: { userId: number; organizationId: string; locationId: string; goal: AgentGoal; idempotencyKey?: string }) {
  const workspace = await requireWorkspaceMember(input.userId, input.organizationId); requireOperatorRole(workspace.role);
  await requireLocationMember(input.userId, input.organizationId, input.locationId); const db = await requireQueueDb();
  if (input.idempotencyKey) { const existing = (await db.select().from(autonomousAgentRuns).where(and(eq(autonomousAgentRuns.organizationId, input.organizationId), eq(autonomousAgentRuns.idempotencyKey, input.idempotencyKey))).limit(1))[0]; if (existing) return existing; }
  const id = nanoid(); await db.insert(autonomousAgentRuns).values({ id, organizationId: input.organizationId, userId: input.userId, locationId: input.locationId, goal: input.goal, status: "QUEUED", plannerType: "HYBRID", llmProvider: "groq", llmModel: process.env.GROQ_MODEL || "qwen/qwen3.6-27b", idempotencyKey: input.idempotencyKey ?? null, fallbackUsed: !process.env.GROQ_API_KEY });
  return (await db.select().from(autonomousAgentRuns).where(eq(autonomousAgentRuns.id, id)).limit(1))[0];
}

export async function processQueuedAgentRuns(limit = 3) {
  const db = await requireQueueDb();
  const queued = await db.select().from(autonomousAgentRuns).where(and(eq(autonomousAgentRuns.status, "QUEUED"), eq(autonomousAgentRuns.cancelRequested, false))).orderBy(asc(autonomousAgentRuns.createdAt)).limit(Math.max(1, Math.min(10, limit)));
  const results: Array<{ runId: string; status: string }> = [];
  for (const run of queued) {
    try { await db.update(autonomousAgentRuns).set({ status: "INITIALIZING", lastHeartbeatAt: new Date() }).where(and(eq(autonomousAgentRuns.id, run.id), eq(autonomousAgentRuns.status, "QUEUED"))); await runAutonomousAgent({ runId: run.id, userId: run.userId, organizationId: run.organizationId, locationId: run.locationId, goal: run.goal as AgentGoal }); results.push({ runId: run.id, status: "COMPLETED" }); }
    catch { results.push({ runId: run.id, status: "FAILED" }); }
  }
  return { processed: results.length, results };
}
