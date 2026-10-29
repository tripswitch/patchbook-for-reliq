import { BACKUP_FORMAT, SCHEMA_VERSION, SIGNALS, type Signal } from "./types";
import type { Backup, JackData, ModuleOverride, Patch, Rack, SharePayload } from "./types";
import { JACKS, isCableColour, isHexColour } from "./panel";
import { clampTime, nowIso } from "./util";

export function makeBackup(patches: Patch[], racks: Rack[], moduleOverrides: ModuleOverride[]): Backup {
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), patches, racks, moduleOverrides };
}

export class ImportError extends Error {}

const str = (v: unknown): v is string => typeof v === "string";
/** Own keys only: names like __proto__ or constructor never count as real entries. */
const has = (o: object, k: string) => Object.hasOwn(o, k);
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Limits for everything that comes from outside the app: backup files, share links and other
 * devices. They match the input fields (or are generous where a field has no limit), and keep
 * every record well under the sync server's per-item size.
 */
export const LIMITS = {
  id: /^[A-Za-z0-9_-]{1,100}$/,
  name: 80,
  notes: 4000,
  role: 120,
  mod: 100,
  to: 120,
  note: 1000,
  trackName: 60,
  std: 40,
  clock: 40,
  rackModules: 300,
  jacks: 100,
  jackName: 24,
  moduleName: 60,
  patches: 1000,
  racks: 200,
  overrides: 1000,
};

/** A trimmed-to-length string, or undefined if it isn't a non-empty string. */
const text = (v: unknown, max: number) => (str(v) && v ? v.slice(0, max) : undefined);
const validId = (v: unknown): v is string => str(v) && LIMITS.id.test(v);

/** Keep only the fields a patch is allowed to have; drop unknown jack ids. */
export function cleanPatch(raw: unknown): Patch {
  if (!raw || typeof raw !== "object") throw new ImportError("A patch in the file isn't readable.");
  const p = raw as Record<string, unknown>;
  if (!validId(p.id) || !str(p.name)) throw new ImportError("A patch in the file has no id or name.");
  const jacks: Record<string, JackData> = {};
  const rawJacks = (p.jacks && typeof p.jacks === "object" ? p.jacks : {}) as Record<string, Record<string, unknown>>;
  for (const [id, j] of Object.entries(rawJacks)) {
    if (!has(JACKS, id) || !j || typeof j !== "object") continue;
    const d: JackData = {};
    const role = text(j.role, LIMITS.role), mod = text(j.mod, LIMITS.mod), to = text(j.to, LIMITS.to), note = text(j.note, LIMITS.note);
    if (role) d.role = role;
    if (mod) d.mod = mod;
    if (to) d.to = to;
    if (note) d.note = note;
    if (isHexColour(j.color)) d.color = j.color.toLowerCase() as `#${string}`;
    else if (isCableColour(j.color)) d.color = j.color;
    if (j.led === "bi" || isCableColour(j.led)) d.led = j.led as JackData["led"];
    else if (isHexColour(j.led)) d.led = j.led.toLowerCase() as `#${string}`;
    if (Object.keys(d).length) jacks[id] = d;
  }
  const tracks: Patch["tracks"] = {};
  const rawTracks = (p.tracks && typeof p.tracks === "object" ? p.tracks : {}) as Record<string, Record<string, unknown>>;
  for (const [n, t] of Object.entries(rawTracks)) {
    const num = Number(n);
    if (!Number.isInteger(num) || num < 1 || num > 16 || String(num) !== n || !t || typeof t !== "object") continue;
    const out: Patch["tracks"][string] = {};
    const name = text(t.name, LIMITS.trackName), std = text(t.std, LIMITS.std), mod = text(t.mod, LIMITS.mod);
    if (name) out.name = name;
    if (std) out.std = std;
    if (t.custom === true) out.custom = true;
    if (mod) out.mod = mod;
    if (Object.keys(out).length) tracks[String(num)] = out;
  }
  const b = (p.brk && typeof p.brk === "object" ? p.brk : {}) as Record<string, unknown>;
  const brk: Patch["brk"] = {};
  const clock = text(b.clock, LIMITS.clock);
  if (clock) brk.clock = clock;
  if (b.reset === "RESET" || b.reset === "RUN" || b.reset === "TRIGGER ON STOP") brk.reset = b.reset;
  if (b.gate === "10" || b.gate === "5") brk.gate = b.gate;
  return {
    id: p.id,
    name: p.name.slice(0, LIMITS.name),
    notes: str(p.notes) ? p.notes.slice(0, LIMITS.notes) : "",
    updatedAt: clampTime(p.updatedAt),
    jacks,
    tracks,
    brk,
  };
}

export function cleanRack(raw: unknown): Rack | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== "object" || !validId(r.id) || !str(r.name) || !Array.isArray(r.modules)) return null;
  const modules = r.modules.filter((m): m is string => str(m) && m.length > 0 && m.length <= LIMITS.mod).slice(0, LIMITS.rackModules);
  const out: Rack = { id: r.id, name: r.name.slice(0, LIMITS.name), modules };
  if (str(r.updatedAt)) out.updatedAt = clampTime(r.updatedAt);
  return out;
}

export function cleanOverride(raw: unknown): ModuleOverride | null {
  const o = raw as Record<string, unknown>;
  if (!o || typeof o !== "object" || !validId(o.id)) return null;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter(str).map((s) => s.trim().slice(0, LIMITS.jackName)).filter((s) => s && !RESERVED.has(s)))].slice(0, LIMITS.jacks)
      : undefined;
  const out: ModuleOverride = { id: o.id, updatedAt: clampTime(o.updatedAt) };
  const ins = list(o.inputs), outs = list(o.outputs);
  if (ins) out.inputs = ins;
  if (outs) out.outputs = outs;
  if (o.custom === true) out.custom = true;
  const name = text(o.name, LIMITS.moduleName), maker = text(o.maker, LIMITS.moduleName);
  if (name) out.name = name;
  if (maker) out.maker = maker;
  if (Number.isInteger(o.hp) && (o.hp as number) >= 1 && (o.hp as number) <= 168) out.hp = o.hp as number;
  if (o.signals && typeof o.signals === "object" && !Array.isArray(o.signals)) {
    const sg = Object.entries(o.signals as Record<string, unknown>)
      .filter((e): e is [string, Signal] => str(e[1]) && (SIGNALS as string[]).includes(e[1]) && e[0].length <= LIMITS.jackName && !RESERVED.has(e[0]))
      .slice(0, LIMITS.jacks * 2);
    if (sg.length) out.signals = Object.fromEntries(sg);
  }
  return out;
}

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("That file isn't valid JSON.");
  }
  const d = data as Record<string, unknown>;
  if (!d || d.format !== BACKUP_FORMAT) throw new ImportError("That file isn't a Patchbook backup.");
  if (typeof d.schemaVersion !== "number" || d.schemaVersion > SCHEMA_VERSION)
    throw new ImportError("That backup was made by a newer version of Patchbook. Reload the app to update, then try again.");
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: str(d.exportedAt) ? d.exportedAt : nowIso(),
    patches: (Array.isArray(d.patches) ? d.patches : []).slice(0, LIMITS.patches).map(cleanPatch),
    racks: (Array.isArray(d.racks) ? d.racks : []).slice(0, LIMITS.racks).map(cleanRack).filter((r): r is Rack => !!r),
    moduleOverrides: (Array.isArray(d.moduleOverrides) ? d.moduleOverrides : [])
      .slice(0, LIMITS.overrides)
      .map(cleanOverride)
      .filter((o): o is ModuleOverride => !!o),
  };
}

export function parseSharePayload(data: unknown): SharePayload {
  const d = data as Record<string, unknown>;
  if (!d || d.format !== BACKUP_FORMAT || d.kind !== "patch") throw new ImportError("That link doesn't contain a Patchbook patch.");
  if (typeof d.schemaVersion !== "number" || d.schemaVersion > SCHEMA_VERSION)
    throw new ImportError("That link was made by a newer version of Patchbook. Reload the app to update.");
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    kind: "patch",
    patch: cleanPatch(d.patch),
    modules: (Array.isArray(d.modules) ? d.modules : []).slice(0, 50).map(cleanOverride).filter((o): o is ModuleOverride => !!o),
  };
}
