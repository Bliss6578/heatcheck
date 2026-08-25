import type { NormalizedObservation } from "./types";
import { createBoundingPolygon, detectHotspots } from "./geo";

const FORTYGUARD_BASE_URL = `${(process.env.FORTYGUARD_BASE_URL ?? "https://api.fortyguard.com").replace(/\/$/, "")}/v1`;
const MAX_POLL_ATTEMPTS = Number(
  process.env.FORTYGUARD_MAX_POLL_ATTEMPTS ?? 40
);
const POLL_DELAY_MS = Number(process.env.FORTYGUARD_POLL_INTERVAL_MS ?? 3_000);

type ProviderActivity = { activityId: string; endpoint: string; raw: unknown };
type ActivityResult = {
  status: string;
  result?: Record<string, unknown>;
  raw: unknown;
};

export class FortyGuardError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REQUEST"
      | "AUTHENTICATION"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "RATE_LIMIT"
      | "UPSTREAM"
      | "TIMEOUT"
      | "FAILED_TASK",
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "FortyGuardError";
  }
}

function isoDateTime(date: Date) {
  return {
    start_date: date.toISOString().slice(0, 10),
    start_time: date.toISOString().slice(11, 16),
    filter_type: 1,
  };
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value !== -999
    ? value
    : null;
}

function firstNumber(value: unknown): number | null {
  if (Array.isArray(value)) return numberFrom(value[0]);
  return numberFrom(value);
}

export function areaOfInterest(
  latitude: number,
  longitude: number,
  configuredPolygon: unknown,
  radiusKm = 1
) {
  if (configuredPolygon && typeof configuredPolygon === "object")
    return configuredPolygon;
  return createBoundingPolygon(latitude, longitude, radiusKm);
}

export class FortyGuardClient {
  constructor(private readonly apiKey = process.env.FORTYGUARD_API_KEY) {}

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  private async request(path: string, init: RequestInit) {
    if (!this.apiKey)
      throw new FortyGuardError(
        "AUTHENTICATION",
        "FortyGuard is not configured."
      );
    let response: Response;
    try {
      response = await fetch(`${FORTYGUARD_BASE_URL}${path}`, {
        ...init,
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError")
        throw new FortyGuardError(
          "TIMEOUT",
          "FortyGuard did not respond within the request timeout."
        );
      throw new FortyGuardError("UPSTREAM", "FortyGuard could not be reached.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code =
        response.status === 400 || response.status === 422
          ? "INVALID_REQUEST"
          : response.status === 401
            ? "AUTHENTICATION"
            : response.status === 403
              ? "FORBIDDEN"
              : response.status === 404
                ? "NOT_FOUND"
                : response.status === 429
                  ? "RATE_LIMIT"
                  : "UPSTREAM";
      throw new FortyGuardError(
        code,
        code === "FORBIDDEN"
          ? "This FortyGuard capability is not available for the configured plan or region."
          : `FortyGuard request failed (${response.status}).`,
        response.status
      );
    }
    return payload as { data?: Record<string, unknown> };
  }

  private async submit(
    path: string,
    payload: Record<string, unknown>,
    endpoint: string
  ): Promise<ProviderActivity> {
    const response = await this.request(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const activityId = response.data?.activity_id;
    if (typeof activityId !== "string")
      throw new FortyGuardError(
        "UPSTREAM",
        `FortyGuard ${endpoint} response did not include an activity_id.`
      );
    return { activityId, endpoint, raw: response };
  }

  async submitHeatmap(input: {
    latitude: number;
    longitude: number;
    polygonGeojson: unknown;
    occurredAt: Date;
  }) {
    const payload = {
      polygon_aoi: areaOfInterest(
        input.latitude,
        input.longitude,
        input.polygonGeojson
      ),
      date_time: isoDateTime(input.occurredAt),
      granularity: 100,
    };
    return this.submit(
      "/heatmap",
      { ...payload, analytic_type: "tcm" },
      "heatmap"
    );
  }

  async submitEnvironmentalParameters(input: {
    latitude: number;
    longitude: number;
    temperature: number;
    occurredAt: Date;
  }) {
    const payload = {
      latitude: input.latitude,
      longitude: input.longitude,
      temperature: input.temperature,
      date_time: isoDateTime(input.occurredAt),
      analysis: [
        "heat_index_celsius",
        "apparent_temperature_celsius",
        "wet_bulb_temperature_celsius",
        "relative_humidity_percent",
        "air_quality:idx",
        "solar_irradiance",
      ],
    };
    return this.submit("/env_params", payload, "env_params");
  }

  submitStreetView(latitude: number, longitude: number) {
    return this.submit("/streetview", { latitude, longitude }, "streetview");
  }
  submitSatellite(
    latitude: number,
    longitude: number,
    polygonGeojson?: unknown
  ) {
    return this.submit(
      "/satellite",
      {
        latitude,
        longitude,
        polygon_aoi: areaOfInterest(latitude, longitude, polygonGeojson),
      },
      "satellite"
    );
  }
  submitHeatIntelligence(input: {
    latitude: number;
    longitude: number;
    temperature: number;
    date?: string;
  }) {
    return this.submit(
      "/heat_intelligence",
      {
        latitude: input.latitude,
        longitude: input.longitude,
        temperature: input.temperature,
        date: input.date ?? new Date().toISOString().slice(0, 10),
        analysis: [
          "geographic",
          "environmental",
          "urban",
          "events",
          "anthropogenic",
        ],
      },
      "heat_intelligence"
    );
  }

  async getActivity(activityId: string): Promise<ActivityResult> {
    const response = await this.request(
      `/status/${encodeURIComponent(activityId)}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    const status = String(response.data?.status ?? "Processing");
    return {
      status,
      result: response.data?.result as Record<string, unknown> | undefined,
      raw: response,
    };
  }

  async awaitActivity(activityId: string): Promise<ActivityResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const result = await this.getActivity(activityId);
      const state = result.status.toLowerCase();
      if (state === "completed" || state === "succeeded") return result;
      if (state === "failed" || state === "error")
        throw new FortyGuardError(
          "FAILED_TASK",
          `FortyGuard activity ${activityId} failed.`
        );
      await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));
    }
    throw new FortyGuardError(
      "TIMEOUT",
      `FortyGuard activity ${activityId} did not complete within the bounded polling window.`
    );
  }

  normalize(input: {
    heatmap: ActivityResult;
    environment: ActivityResult;
    latitude: number;
    longitude: number;
  }): NormalizedObservation {
    const heatmapStats = (input.heatmap.result?.stats_data ?? {}) as Record<
      string,
      unknown
    >;
    const temperatureStats = (heatmapStats.Temperature_stats ??
      heatmapStats.temperature_stats ??
      {}) as Record<string, unknown>;
    const locations = input.environment.result?.locations;
    const location =
      Array.isArray(locations) &&
      locations[0] &&
      typeof locations[0] === "object"
        ? (locations[0] as Record<string, unknown>)
        : {};
    const parameters = (location.parameters ?? {}) as Record<string, unknown>;
    const solar = (location.solar_irradiance ?? {}) as Record<string, unknown>;
    const clearSky = (solar.clear_sky ?? {}) as Record<string, unknown>;
    const mean = numberFrom(temperatureStats.Mean ?? temperatureStats.mean);
    const maximum = numberFrom(
      temperatureStats.Maximum ?? temperatureStats.maximum
    );
    const geojson =
      input.heatmap.result?.geojson ?? input.heatmap.result?.data ?? null;
    const detected = detectHotspots(geojson);
    return {
      observedAt: new Date(),
      temperature: numberFrom(location.temperature) ?? mean,
      minimumTemperature: numberFrom(
        temperatureStats.Minimum ?? temperatureStats.minimum
      ),
      maximumTemperature: maximum,
      meanTemperature: mean,
      apparentTemperature: firstNumber(parameters.apparent_temperature_celsius),
      heatIndex: firstNumber(parameters.heat_index_celsius),
      wetBulbTemperature: firstNumber(parameters.wet_bulb_temperature_celsius),
      relativeHumidity: firstNumber(parameters.relative_humidity_percent),
      aqi: firstNumber(parameters["air_quality:idx"]),
      pm25: firstNumber(parameters["air_quality_pm2p5:idx"]),
      pm10: firstNumber(parameters["air_quality_pm10:idx"]),
      solarIrradiance: numberFrom(clearSky.ghi),
      source: "FORTYGUARD",
      summary: {
        provider: "FortyGuard",
        heatmapStats,
        geojson,
        environmentalMetadata: input.environment.result?.metadata ?? null,
      },
      hotspots: detected.length
        ? detected.map((hotspot, index) => ({
            label: `Hotspot ${index + 1}`,
            latitude: hotspot.latitude,
            longitude: hotspot.longitude,
            temperature: hotspot.temperature,
            workersExposed: 0,
            metadata: {
              anomaly: hotspot.anomaly,
              riskScore: hotspot.riskScore,
            },
          }))
        : [
            {
              label: "Thermal area of interest",
              latitude: input.latitude,
              longitude: input.longitude,
              temperature: maximum ?? mean ?? 0,
              workersExposed: 0,
            },
          ],
    };
  }
}
