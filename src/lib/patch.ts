import type { JackData, JackId, Patch, Zone } from "./types";
import { DIR_TEXT, JACKS, KIND_OF, ORDER, RESET_MODES, ZONE_NAME, cableName, kindOf, trackOf } from "./panel";
import type { Library } from "./library";

export const isPatched = (d?: JackData) => !!(d && (d.to || d.mod || d.role || d.color || d.led));

/** Custom (#rrggbb) cable colours used anywhere in these patches, for the "yours" swatches. */
export function customColours(patches: Patch[], limit = 12): string[] {
  const seen = new Set<string>();
  for (const p of [...patches].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")))
    for (const d of Object.values(p.jacks)) {
      if (d.color && d.color.startsWith("#")) seen.add(d.color.toLowerCase());
      if (seen.size >= limit) return [...seen];
    }
  return [...seen];
}
export const hasContent = (d?: JackData) => isPatched(d) || !!d?.note;

export function trackLabel(p: Patch | null, n: number): string {
  const t = p?.tracks[n];
  return `Track ${n}${t?.name ? ` · ${t.name}` : ""}`;
}

/** The label a CV/Gate jack gets from its named track, unless the track uses custom routing. */
export function derivedRole(p: Patch | null, id: JackId): string {
  const n = trackOf(id);
  if (!n || !p) return "";
  const t = p.tracks[n];
  if (!t || t.custom) return "";
  return `Track ${n}${t.name ? ` ${t.name}` : ""} · ${KIND_OF[kindOf(id)]}`;
}

export const roleText = (p: Patch | null, id: JackId) => p?.jacks[id]?.role || derivedRole(p, id);

export function targetText(lib: Library, d?: JackData): string {
  if (!d) return "";
  const m = d.mod ? lib.get(d.mod) : undefined;
  if (m) return m.name + (d.to ? ` › ${d.to}` : "");
  if (d.mod) return d.mod + (d.to ? ` › ${d.to}` : "");
  return d.to ?? "";
}

export function countZones(p: Patch | null): Record<Zone, number> {
  const c: Record<Zone, number> = { audio: 0, cv: 0, gate: 0, sync: 0 };
  if (p) for (const id of ORDER) if (isPatched(p.jacks[id])) c[JACKS[id].zone]++;
  return c;
}

export function breakoutSummary(p: Patch | null): string {
  const b = p?.brk ?? {};
  const out: string[] = [];
  if (b.clock) out.push(`CLK ${b.clock}`);
  const r = RESET_MODES.find((x) => x.value === b.reset);
  if (r) out.push(`RST ${r.short}`);
  if (b.gate) out.push(`Gates 0–${b.gate}V`);
  return out.map((s) => s.replace(/ /g, " ")).join(" · ");
}

/** Plain-text version of a patch, for pasting into notes. */
export function patchAsText(p: Patch, lib: Library): string {
  const lines: string[] = [`RELIQ BREAKOUT — ${p.name}`];
  if (p.notes) lines.push(p.notes);
  lines.push("");
  const bs = breakoutSummary(p).replace(/ /g, " ");
  if (bs) lines.push(`Breakout settings: ${bs}`, "");
  const tracks = Object.keys(p.tracks).map(Number).sort((a, b) => a - b);
  if (tracks.length) {
    lines.push("## Tracks");
    for (const n of tracks) {
      const t = p.tracks[n];
      lines.push(
        `- Track ${n}${t.name ? `: ${t.name}` : ""} (A${n} pitch, B${n} vel/mod, Gate ${n})` +
          (t.std ? ` [${t.std}]` : "") +
          (t.custom ? " — custom output routing" : "") +
          (t.mod && lib.get(t.mod) ? ` → ${lib.get(t.mod)!.name}` : ""),
      );
    }
    lines.push("");
  }
  for (const z of ["audio", "cv", "gate", "sync"] as Zone[]) {
    const ids = ORDER.filter((id) => JACKS[id].zone === z && hasContent(p.jacks[id]));
    if (!ids.length) continue;
    lines.push(`## ${ZONE_NAME[z]}`);
    for (const id of ids) {
      const j = JACKS[id], d = p.jacks[id];
      lines.push(
        `- ${j.name} (${DIR_TEXT[j.dir].toLowerCase()}): ${roleText(p, id) || "—"} ${j.dir === "in" ? "←" : "→"} ${targetText(lib, d) || "—"}` +
          (d.color || d.led ? ` [${[cableName(d.color), d.led ? (d.led === "bi" ? "LED: bi-colour" : `LED: ${cableName(d.led)}`) : ""].filter(Boolean).join(", ")}]` : "") +
          (d.note ? ` — ${d.note}` : ""),
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Custom (non-library) modules a patch refers to, so a share link can carry them. */
export function customModulesUsed(p: Patch, lib: Library): string[] {
  const ids = new Set<string>();
  for (const d of Object.values(p.jacks)) if (d.mod && lib.get(d.mod)?.custom) ids.add(d.mod);
  for (const t of Object.values(p.tracks)) if (t.mod && lib.get(t.mod)?.custom) ids.add(t.mod);
  return [...ids];
}
