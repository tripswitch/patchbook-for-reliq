import type { Direction, ModuleDef, ModuleOverride, Rack } from "./types";
import { byName } from "./util";

/**
 * The working module list: the bundled community library with the user's local
 * edits applied, plus any custom modules they've added.
 */
export type Library = Map<string, ModuleDef & { edited?: boolean; custom?: boolean; librarySignals?: ModuleDef["signals"] }>;

export function buildLibrary(base: ModuleDef[], overrides: ModuleOverride[]): Library {
  const lib: Library = new Map(base.map((m) => [m.id, { ...m }]));
  for (const o of overrides) {
    const existing = lib.get(o.id);
    if (existing) {
      lib.set(o.id, {
        ...existing,
        inputs: o.inputs ?? existing.inputs,
        outputs: o.outputs ?? existing.outputs,
        signals: o.signals ? { ...existing.signals, ...o.signals } : existing.signals,
        librarySignals: existing.signals,
        edited: true,
      });
    } else if (o.custom) {
      lib.set(o.id, {
        id: o.id,
        name: o.name || o.id,
        maker: o.maker || "Unknown maker",
        hp: o.hp,
        inputs: o.inputs ?? [],
        outputs: o.outputs ?? [],
        signals: o.signals,
        confidence: "low",
        source: "Added in Patchbook",
        custom: true,
      });
    }
  }
  return lib;
}

/** A Breakout "in" jack receives from a module's OUTPUTS; every other jack feeds a module's INPUTS. */
export const listKey = (dir: Direction): "inputs" | "outputs" => (dir === "in" ? "outputs" : "inputs");

export function jackList(lib: Library, modId: string | undefined, dir: Direction): string[] | null {
  if (!modId) return null;
  const m = lib.get(modId);
  const l = m?.[listKey(dir)];
  return l && l.length ? l : null;
}

/** Pick the one jack whose name matches, e.g. V/OCT for a pitch CV. Returns "" when none or several match. */
export function guessJack(lib: Library, modId: string, pattern: RegExp): string {
  const l = jackList(lib, modId, "out");
  if (!l) return "";
  const hits = l.filter((j) => pattern.test(j));
  return hits.length === 1 ? hits[0] : "";
}

export const GUESS_PATTERNS: Record<"a" | "g", RegExp> = {
  a: /v\/?oct|pitch|1v\/o/i,
  g: /trig|gate/i,
};

export function moduleLabel(lib: Library, id: string | undefined): string {
  if (!id) return "";
  return lib.get(id)?.name ?? id;
}

/** Groups for the module picker: the user's racks first, then everything else in the library by maker. */
export function moduleGroups(lib: Library, racks: Rack[]) {
  const inRacks = new Set<string>();
  const groups: { label: string; modules: { id: string; name: string }[] }[] = [];
  for (const r of racks) {
    const mods = r.modules
      .filter((id) => lib.has(id))
      .map((id) => {
        inRacks.add(id);
        return { id, name: lib.get(id)!.name };
      });
    if (mods.length) groups.push({ label: r.name, modules: dedupe(mods) });
  }
  const rest = [...lib.values()].filter((m) => !inRacks.has(m.id));
  if (rest.length) {
    groups.push({
      label: racks.length ? "Other modules in the library" : "Module library",
      modules: rest
        .sort((a, b) => a.maker.localeCompare(b.maker) || byName(a, b))
        .map((m) => ({ id: m.id, name: `${m.name} · ${m.maker}` })),
    });
  }
  return groups;
}

function dedupe<T extends { id: string }>(xs: T[]) {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** A module in the shape the community library expects, for contributing an edit or a new module. */
export function toLibraryJson(m: ModuleDef & { edited?: boolean; custom?: boolean; librarySignals?: ModuleDef["signals"] }): ModuleDef {
  const { edited: _e, custom: _c, librarySignals: _l, signals, ...rest } = m;
  const jacks = new Set([...m.inputs, ...m.outputs]);
  const kept = signals && Object.fromEntries(Object.entries(signals).filter(([j]) => jacks.has(j)));
  return {
    ...rest,
    ...(kept && Object.keys(kept).length ? { signals: kept } : {}),
    confidence: m.custom ? "low" : m.confidence,
    source: m.custom ? "Describe where these jack names came from (manual page or panel photo)" : m.source,
  };
}
