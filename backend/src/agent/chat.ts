import Groq from "groq-sdk";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { agentActions, autonomousAgentRuns, heatObservations, incidents } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { requireLocationMember, requireWorkspaceMember } from "../heatcheck/tenant.js";
import { AGENT_CONFIG } from "./config.js";
import { callWeatherMcp } from "./mcp/weather-mcp.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

function deterministicAnswer(context: Record<string, unknown>) {
  const observation = context.latestObservation as Record<string, unknown> | null;
  if (!observation)
    return "I do not have a completed heat observation for this location yet. Ask me to analyze the selected location to create one.";
  const trend = context.latestRun as Record<string, unknown> | null;
  return `The latest recorded operational heat risk is ${observation.riskScore ?? "unknown"}/100 (${observation.riskLevel ?? "unclassified"}) at ${observation.temperature ?? "unknown"}°C. ${trend?.status ? `The latest agent run is ${trend.status}.` : ""}`.trim();
}

export async function chatWithHeatCheck(input: {
  userId: number;
  organizationId: string;
  locationId: string;
  message: string;
  history?: ChatMessage[];
}) {
  await requireWorkspaceMember(input.userId, input.organizationId);
  const location = await requireLocationMember(input.userId, input.organizationId, input.locationId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "HeatCheck memory is unavailable." });
  const [latestObservation, latestRun, openIncidents, pendingActions] = await Promise.all([
    db.select().from(heatObservations).where(and(eq(heatObservations.organizationId, input.organizationId), eq(heatObservations.locationId, input.locationId))).orderBy(desc(heatObservations.observedAt)).limit(1),
    db.select().from(autonomousAgentRuns).where(and(eq(autonomousAgentRuns.organizationId, input.organizationId), eq(autonomousAgentRuns.locationId, input.locationId))).orderBy(desc(autonomousAgentRuns.createdAt)).limit(1),
    db.select().from(incidents).where(and(eq(incidents.organizationId, input.organizationId), eq(incidents.locationId, input.locationId))).orderBy(desc(incidents.startedAt)).limit(5),
    db.select().from(agentActions).where(eq(agentActions.organizationId, input.organizationId)).orderBy(desc(agentActions.createdAt)).limit(5),
  ]);
  const observation = latestObservation[0];
  const needsLiveWeather = /\b(weather|forecast|alert|warning|today|tomorrow|outside conditions)\b/i.test(input.message);
  let weatherContext: Awaited<ReturnType<typeof callWeatherMcp>> | null = null;
  if (needsLiveWeather) {
    try {
      weatherContext = await callWeatherMcp("get_weather_summary", { latitude: location.latitude, longitude: location.longitude, include: ["current", "forecast", "alerts"], days: 2, detail: "summary", units: "metric" });
    } catch { /* the durable HeatCheck record remains available as fallback */ }
  }
  const context = {
    location: { name: location.name },
    latestObservation: observation ? {
      observedAt: observation.observedAt,
      temperature: observation.temperature,
      apparentTemperature: observation.apparentTemperature,
      heatIndex: observation.heatIndex,
      wetBulbTemperature: observation.wetBulbTemperature,
      relativeHumidity: observation.relativeHumidity,
      solarIrradiance: observation.solarIrradiance,
      riskScore: observation.riskScore,
      riskLevel: observation.riskLevel,
    } : null,
    latestRun: latestRun[0] ? { id: latestRun[0].id, status: latestRun[0].status, goal: latestRun[0].goal, riskScore: latestRun[0].riskScore, riskLevel: latestRun[0].riskLevel, completedAt: latestRun[0].completedAt } : null,
    openIncidents: openIncidents.map(item => ({ severity: item.severity, riskScore: item.riskScore, title: item.title, status: item.status })),
    recentActions: pendingActions.map(item => ({ type: item.actionType, status: item.status, target: item.target })),
    weatherMcp: weatherContext,
  };

  if (!process.env.GROQ_API_KEY)
    return { message: deterministicAnswer(context), model: "deterministic-fallback", fallbackUsed: true };

  try {
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: AGENT_CONFIG.timeoutMs, maxRetries: 0 });
    const response = await client.chat.completions.create({
      model: AGENT_CONFIG.model,
      temperature: AGENT_CONFIG.temperature,
      top_p: AGENT_CONFIG.topP,
      max_completion_tokens: AGENT_CONFIG.maxCompletionTokens,
      messages: [
        { role: "system", content: "You are the HeatCheck workspace assistant. Answer only from the supplied tenant-scoped operational context. Be concise, cite risk scores and timestamps when present, explain uncertainty, and never invent live conditions. You cannot execute actions in chat; direct the user to the Agent Command Center when a fresh analysis is needed. Never reveal secrets, raw provider payloads, or data from another workspace." },
        ...((input.history ?? []).slice(-8)),
        { role: "user", content: `Operational context:\n${JSON.stringify(context)}\n\nUser question: ${input.message}` },
      ],
    });
    const message = response.choices[0]?.message?.content?.trim();
    return { message: message || deterministicAnswer(context), model: AGENT_CONFIG.model, fallbackUsed: !message };
  } catch {
    return { message: deterministicAnswer(context), model: "deterministic-fallback", fallbackUsed: true };
  }
}
