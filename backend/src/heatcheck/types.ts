export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "SEVERE" | "CRITICAL";
export type AgentMode = "OBSERVE" | "RECOMMEND" | "AUTONOMOUS";

export type NormalizedObservation = {
  observedAt: Date;
  temperature: number | null;
  minimumTemperature: number | null;
  maximumTemperature: number | null;
  meanTemperature: number | null;
  apparentTemperature: number | null;
  heatIndex: number | null;
  wetBulbTemperature: number | null;
  relativeHumidity: number | null;
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  solarIrradiance: number | null;
  source: "FORTYGUARD" | "SIMULATION";
  rawReference?: string;
  summary: Record<string, unknown>;
  hotspots: Array<{
    label: string;
    latitude: number;
    longitude: number;
    temperature: number;
    workersExposed: number;
    metadata?: Record<string, unknown>;
  }>;
};

export type RiskAssessment = {
  score: number;
  level: RiskLevel;
  operationalExposureScore: number;
  factors: Array<{ factor: string; score: number; weight: number; contribution: number }>;
  summary: string;
};

export type ProposedAction = {
  actionType: "RECORD_INCIDENT_NOTE" | "DRAFT_HEAT_ALERT" | "REQUEST_OUTDOOR_TASK_SHIFT" | "ACTIVATE_HEATCHECK_PROTOCOL" | "START_VERIFICATION";
  target: string;
  rationale: string;
};

export type DecisionPlan = {
  status: "COMPLETED" | "UNAVAILABLE" | "FAILED";
  decision: string;
  summary: string;
  reasoningSummary: string;
  actions: ProposedAction[];
  structuredOutput: Record<string, unknown>;
};
