/**
 * Build the scheduled start time for a huddle from a local date (YYYY-MM-DD) and a
 * 24-hour time (HH:MM), as the user entered them. Returns an ISO string in UTC, or null
 * when either part is missing or malformed.
 *
 * The date is built from its parts in local time. `new Date("YYYY-MM-DD")` parses as UTC
 * midnight, which shifts the huddle to the wrong day for users west of UTC.
 */
export function buildScheduledAt(date: string, time: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Reject dates that rolled over, e.g. 2026-02-31 becomes March 3.
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) return null;
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}
