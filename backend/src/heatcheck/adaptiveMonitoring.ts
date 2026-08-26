export function adaptiveMonitoringMinutes(riskScore: number, baseMinutes: number) {
  const base = Math.max(5, Math.min(1440, baseMinutes));
  if (riskScore >= 90) return 5;
  if (riskScore >= 76) return Math.min(base, 10);
  if (riskScore >= 60) return Math.min(base, 15);
  if (riskScore >= 40) return Math.min(Math.max(base, 30), 60);
  return Math.min(Math.max(base * 2, 60), 240);
}

export function nextAdaptiveAnalysisAt(riskScore: number, baseMinutes: number, now = new Date()) {
  return new Date(now.getTime() + adaptiveMonitoringMinutes(riskScore, baseMinutes) * 60_000);
}
