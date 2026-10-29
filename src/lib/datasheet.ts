import type { ModuleDef } from "./types";
import { normalise } from "./util";

export interface SheetMatch {
  id: string;
  name: string;
  count: number;
}

/**
 * Finds library modules in text pasted from a ModularGrid rack Data Sheet (or rack page).
 * Each module is matched on "maker + name" as ModularGrid lists it, longest names first,
 * so "Plinky Expander" isn't also counted as "Plinky". A rack can hold the same module twice.
 */
export function matchDataSheet(text: string, modules: ModuleDef[]): SheetMatch[] {
  const hay = ` ${normalise(text)} `;
  const taken: boolean[] = new Array(hay.length).fill(false);
  const candidates = modules
    .flatMap((m) => {
      const keys = new Set<string>();
      if (m.modulargrid?.listedAs) keys.add(normalise(m.modulargrid.listedAs));
      keys.add(normalise(`${m.maker} ${m.name}`));
      return [...keys].filter((k) => k.length >= 3).map((key) => ({ m, key }));
    })
    .sort((a, b) => b.key.length - a.key.length);

  const counts = new Map<string, number>();
  for (const { m, key } of candidates) {
    const needle = ` ${key} `;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      if (!taken.slice(at + 1, end - 1).some(Boolean)) {
        for (let i = at + 1; i < end - 1; i++) taken[i] = true;
        counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
      }
      from = at + 1;
    }
  }
  const byId = new Map(modules.map((m) => [m.id, m]));
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: byId.get(id)!.name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
