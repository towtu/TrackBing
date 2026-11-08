export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80 || (value !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value))) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

export function localDay(now: Date, timeZone: string): string {
  if (!validTimeZone(timeZone) || !Number.isFinite(now.getTime())) throw new Error("Invalid local date");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateMillis(day: string): number {
  const time = Date.parse(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) throw new Error("Invalid day");
  return time;
}

export function shiftDay(day: string, days: number): string {
  return new Date(dateMillis(day) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Find the first instant of a local day, including zones with a midnight DST jump. */
function dayStart(day: string, timeZone: string): number {
  const nominal = dateMillis(day);
  let low = nominal - 36 * 3_600_000;
  let high = nominal + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDay(new Date(middle), timeZone) < day) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function dayBounds(day: string, timeZone: string): { start: string; end: string } {
  const start = dayStart(day, timeZone);
  const end = dayStart(shiftDay(day, 1), timeZone);
  if (start === end) throw new Error("Local day does not exist");
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
