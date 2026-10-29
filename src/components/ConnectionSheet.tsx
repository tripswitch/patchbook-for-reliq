import type { JackId, Patch, Zone } from "../lib/types";
import { DIR_TEXT, JACKS, ORDER, cableHex, cableName, ledHex } from "../lib/panel";
import { countZones, derivedRole, hasContent, targetText } from "../lib/patch";
import type { Library } from "../lib/library";

interface Props {
  patch: Patch | null;
  library: Library;
  zoneFilter: Zone | "all";
  moduleFilter: string;
  setZoneFilter: (z: Zone | "all") => void;
  setModuleFilter: (m: string) => void;
  onJack: (id: JackId) => void;
}

const ZONES: [Zone | "all", string, string | null][] = [
  ["all", "All", null], ["audio", "Matrix", "audio"], ["cv", "CV", "cv"], ["gate", "Gate", "gate"], ["sync", "Clock/Reset", "silk-dim"],
];

export function ConnectionSheet({ patch, library, zoneFilter, moduleFilter, setZoneFilter, setModuleFilter, onJack }: Props) {
  const c = countZones(patch);
  const total = c.audio + c.cv + c.gate + c.sync;
  const used = new Map<string, number>();
  if (patch) for (const id of ORDER) {
    const m = patch.jacks[id]?.mod;
    if (m) used.set(m, (used.get(m) ?? 0) + 1);
  }
  const mf = moduleFilter && used.has(moduleFilter) ? moduleFilter : "";
  const ids = patch
    ? ORDER.filter((id) => hasContent(patch.jacks[id]))
        .filter((id) => zoneFilter === "all" || JACKS[id].zone === zoneFilter)
        .filter((id) => !mf || patch.jacks[id]?.mod === mf)
    : [];

  return (
    <section className="sheet">
      <div className="sheet-head">
        <h3>Connection sheet</h3>
        <div className="chips">
          {ZONES.map(([k, label, col]) => (
            <button key={k} type="button" className="chip" aria-pressed={zoneFilter === k} onClick={() => setZoneFilter(k)}>
              {col && <i style={{ background: `var(--${col})` }} />}
              {label} {k === "all" ? total : c[k as Zone]}
            </button>
          ))}
        </div>
        <select aria-label="Show one module" value={mf} disabled={!used.size} onChange={(e) => setModuleFilter(e.target.value)}>
          <option value="">All modules</option>
          {[...used.entries()]
            .sort((a, b) => (library.get(a[0])?.name ?? a[0]).localeCompare(library.get(b[0])?.name ?? b[0]))
            .map(([id, n]) => (
              <option key={id} value={id}>
                {library.get(id)?.name ?? id} ({n})
              </option>
            ))}
        </select>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Jack</th><th>Reliq side</th><th>Patched to</th><th>Cable</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {!ids.length && (
              <tr>
                <td colSpan={5} className="empty-sheet">
                  {patch ? "Nothing logged here yet. Click a jack on the panel to add the first connection." : "Start a patch to begin logging connections."}
                </td>
              </tr>
            )}
            {ids.map((id) => {
              const j = JACKS[id], d = patch!.jacks[id];
              const zc = `var(--${j.zone === "sync" ? "silk-dim" : j.zone})`;
              const derived = derivedRole(patch, id);
              const go = () => onJack(id);
              return (
                <tr key={id} className="srow" tabIndex={0} onClick={go} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go())}>
                  <td className="j">
                    <i style={{ background: zc }} />
                    {j.name}
                    <br />
                    <small style={{ color: "var(--muted)" }}>{DIR_TEXT[j.dir]}</small>
                  </td>
                  <td>{d.role ? d.role : derived ? <span className="derived">{derived}</span> : "—"}</td>
                  <td>{targetText(library, d) || "—"}</td>
                  <td>
                    {d.color || d.led ? (
                      <>
                        <span
                          className={`dot${d.led ? " led" : ""}${d.led === "bi" ? " led-bi" : ""}`}
                          style={{ ["--c" as string]: cableHex(d.color) ?? "transparent", ["--led" as string]: ledHex(d.led) ?? "transparent" }}
                        />
                        {cableName(d.color) || "—"}
                        {d.led && <small className="ledtag"> · LED{d.led === "bi" ? " bi-colour" : ""}</small>}
                      </>
                    ) : "—"}
                  </td>
                  <td className="note">{d.note ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
