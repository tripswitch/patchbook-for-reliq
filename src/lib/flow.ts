import type { JackId, Patch } from "./types";
import { JACKS, N16, trackOf } from "./panel";
import { jackList, type Library } from "./library";

/**
 * The order "Next" walks the panel in. Matrix jacks go up by number; CV and gates go a voice
 * at a time (A n, B n, Gate n), because a Reliq track set to CV drives those three together.
 */
export const WALK: JackId[] = [
  ...N16.map((n) => `mi${n}`),
  ...N16.map((n) => `mo${n}`),
  ...N16.flatMap((n) => [`cv${n}a`, `cv${n}b`, `g${n}`]),
  "clk",
  "rst",
];

export function nextJack(id: JackId): JackId | null {
  const i = WALK.indexOf(id);
  return i >= 0 && i < WALK.length - 1 ? WALK[i + 1] : null;
}
export function prevJack(id: JackId): JackId | null {
  const i = WALK.indexOf(id);
  return i > 0 ? WALK[i - 1] : null;
}

/** Jack-name patterns worth suggesting first, by the kind of Reliq jack. */
const SUGGEST: { test: (id: JackId) => boolean; pattern: RegExp }[] = [
  { test: (id) => /^cv\d+a$/.test(id), pattern: /v\/?oct|pitch|1v\/o|\bv\/o\b/i },
  { test: (id) => /^cv\d+b$/.test(id), pattern: /vel|level|\bmod(ulation)?\b|accent|vca|\bamp|timbre|morph/i },
  { test: (id) => /^g\d+$/.test(id), pattern: /trig|gate|strike|strum|clock|clk/i },
  { test: (id) => id === "clk", pattern: /clock|clk|sync/i },
  { test: (id) => id === "rst", pattern: /reset|rst/i },
  { test: (id) => /^mi\d+$/.test(id), pattern: /out|main|mix|left|right|\bl\b|\br\b/i },
  { test: (id) => /^mo\d+$/.test(id), pattern: /\bin\b|input|audio|left|right|\bl\b|\br\b/i },
];

/** The module's jacks for this Reliq jack, with likely matches first. */
export function rankJacks(id: JackId, list: string[]): { name: string; suggested: boolean }[] {
  const rule = SUGGEST.find((r) => r.test(id));
  const hits = rule ? list.filter((j) => rule.pattern.test(j)) : [];
  // A suggestion only helps when it narrows things down.
  const useful = hits.length > 0 && hits.length <= Math.max(2, Math.floor(list.length / 2));
  const set = new Set(useful ? hits : []);
  return [...list.filter((j) => set.has(j)), ...list.filter((j) => !set.has(j))].map((name) => ({ name, suggested: set.has(name) }));
}

/** Where else in this patch a module's jack is already used, keyed by jack name. */
export function jackUse(patch: Patch, modId: string, exclude: JackId): Map<string, string> {
  const used = new Map<string, string>();
  for (const [id, d] of Object.entries(patch.jacks)) {
    if (id === exclude || d.mod !== modId || !d.to || !JACKS[id]) continue;
    used.set(d.to, JACKS[id].label);
  }
  return used;
}

/**
 * Every module used in this patch, most relevant first: the module on the jack walked from,
 * the voice module set on this jack's track, then modules that have the kind of jack this one
 * needs (most used first), then the rest.
 */
export function suggestedModules(patch: Patch, id: JackId, library: Library, cameFrom?: JackId | null): string[] {
  const out: string[] = [];
  const add = (m?: string) => m && library.has(m) && !out.includes(m) && out.push(m);
  if (cameFrom) add(patch.jacks[cameFrom]?.mod);
  const tn = trackOf(id);
  if (tn) add(patch.tracks[tn]?.mod);
  const counts = new Map<string, number>();
  const bump = (m?: string) => m && counts.set(m, (counts.get(m) ?? 0) + 1);
  for (const [jid, d] of Object.entries(patch.jacks)) if (JACKS[jid]) bump(d.mod);
  for (const t of Object.values(patch.tracks)) bump(t.mod);
  const dir = JACKS[id]?.dir;
  const fits = (m: string) => !dir || !!jackList(library, m, dir);
  [...counts.entries()]
    .sort((a, b) => Number(fits(b[0])) - Number(fits(a[0])) || b[1] - a[1])
    .forEach(([m]) => add(m));
  return out;
}

/** Case- and accent-insensitive search over module names and makers. */
export function searchModules(library: Library, q: string, limit = 24): string[] {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return [...library.values()]
    .filter((m) => {
      const hay = norm(`${m.name} ${m.maker}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((m) => m.id);
}
