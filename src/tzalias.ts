/**
 * TZID normalization for identity matching. Different exporters name the
 * same zone differently: Outlook writes Windows display names
 * ("Eastern Standard Time"), some clients prefix a globally-unique-ID
 * path ("/example.test/20260101_1/Europe/Berlin"). Normalizing the TZID
 * before comparison lets a Google export and an Outlook invite of the
 * same meeting match without any timezone-offset math.
 *
 * The alias table covers the Windows zone names seen most often in the
 * wild; it maps to canonical IANA identifiers. Matching stays exact for
 * unlisted names — an unknown TZID only ever matches itself.
 */

const WINDOWS_TO_IANA: Record<string, string> = {
  "afghanistan standard time": "Asia/Kabul",
  "alaskan standard time": "America/Anchorage",
  "arabian standard time": "Asia/Dubai",
  "atlantic standard time": "America/Halifax",
  "aus eastern standard time": "Australia/Sydney",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "central standard time": "America/Chicago",
  "china standard time": "Asia/Shanghai",
  "eastern standard time": "America/New_York",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "hawaiian standard time": "Pacific/Honolulu",
  "india standard time": "Asia/Kolkata",
  "korea standard time": "Asia/Seoul",
  "mountain standard time": "America/Denver",
  "new zealand standard time": "Pacific/Auckland",
  "pacific standard time": "America/Los_Angeles",
  "romance standard time": "Europe/Paris",
  "singapore standard time": "Asia/Singapore",
  "se asia standard time": "Asia/Bangkok",
  "south africa standard time": "Africa/Johannesburg",
  "tokyo standard time": "Asia/Tokyo",
  "us eastern standard time": "America/New_York",
  "us mountain standard time": "America/Phoenix",
  "utc": "Etc/UTC",
  "w. europe standard time": "Europe/Berlin",
};

/**
 * Normalize a TZID for comparison: strip surrounding quotes, drop a
 * leading globally-unique-ID path down to its trailing Area/Location
 * segments, translate known Windows names to IANA, and lowercase.
 */
export function normalizeTzid(tzid: string): string {
  let t = tzid.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
  if (t.startsWith("/")) {
    // "/example.test/20260101_1/America/New_York" -> "America/New_York".
    const parts = t.split("/").filter((p) => p !== "");
    if (parts.length >= 2) t = parts.slice(-2).join("/");
    else if (parts.length === 1) t = parts[0]!;
  }
  const windows = WINDOWS_TO_IANA[t.toLowerCase()];
  if (windows) return windows.toLowerCase();
  return t.toLowerCase();
}
