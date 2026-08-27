import tzLookup from "tz-lookup";

/** Resolve an IANA timezone locally so adding a site never depends on a paid map API. */
export function timezoneForCoordinates(latitude: number, longitude: number) {
  try {
    return tzLookup(latitude, longitude);
  } catch {
    return "UTC";
  }
}
