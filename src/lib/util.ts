export const newId = (prefix = "p") =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const nowIso = () => new Date().toISOString();

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Lowercase, strip accents, collapse everything that isn't a letter or digit to single spaces. */
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

const DAY = 86_400_000;
/**
 * A trustworthy updatedAt: a valid ISO time no later than a day from now. A bad device clock
 * or an edited file could otherwise stamp a record far in the future, and it would then win
 * every later comparison.
 */
export function clampTime(v: unknown): string {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  const now = Date.now();
  if (!Number.isFinite(t)) return new Date(now).toISOString();
  return new Date(Math.min(t, now + DAY)).toISOString();
}
