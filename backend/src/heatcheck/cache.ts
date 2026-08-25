type CacheEntry<T> = { expiresAt: number; value: T };
const memoryCache = new Map<string, CacheEntry<unknown>>();

export function analysisCacheKey(input: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  date?: Date;
  analysisType?: string;
}) {
  const date = input.date ?? new Date();
  return [
    input.latitude.toFixed(3),
    input.longitude.toFixed(3),
    date.toISOString().slice(0, 13),
    (input.radiusKm ?? 1).toFixed(2),
    input.analysisType ?? "full",
  ].join(":");
}

export function getCached<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T) {
  const ttlSeconds = Math.max(
    0,
    Number(process.env.HEATCHECK_CACHE_TTL_SECONDS ?? 600)
  );
  if (ttlSeconds > 0)
    memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
}
