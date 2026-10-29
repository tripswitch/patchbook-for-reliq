import type { CSSProperties } from "react";
import type { JackDef, Patch, Zone } from "../lib/types";
import { cableHex, isDark, ledHex, trackOf } from "../lib/panel";
import { derivedRole, isPatched, roleText, targetText } from "../lib/patch";
import type { Library } from "../lib/library";
import { useCableDrag } from "./CableDrag";

export interface JackView {
  patch: Patch | null;
  library: Library;
  selJack: string | null;
  selTrack: number | null;
  zoneFilter: Zone | "all";
  moduleFilter: string;
  onJack: (id: string) => void;
}

/** One jack: a nut that shows the cable colour when patched, and its printed label. */
export function JackButton({ j, v, label = j.label }: { j: JackDef; v: JackView; label?: string }) {
  const { bind, dragging } = useCableDrag();
  const { patch, library, selJack, selTrack } = v;
  const d = patch?.jacks[j.id];
  const patched = isPatched(d);
  const dim = (v.zoneFilter !== "all" && v.zoneFilter !== j.zone) || (!!v.moduleFilter && d?.mod !== v.moduleFilter);
  const derived = derivedRole(patch, j.id);
  const hex = cableHex(d?.color);
  const led = d?.led;
  const summary = patched
    ? `${j.name}: ${roleText(patch, j.id) || "—"} → ${targetText(library, d) || "not set"}${led ? " · LED cable" : ""}`
    : `${j.name}: empty${derived ? ` (${derived})` : ""}`;
  const cls = [
    "jack",
    patched && "patched",
    selJack === j.id && "sel",
    dragging === j.id && "dragsrc",
    (d?.color === "black" || isDark(hex)) && "dark-cable",
    led && "led",
    led === "bi" && "led-bi",
    dim && "dim",
    selTrack !== null && trackOf(j.id) === selTrack && "intrack",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      data-jack={j.id}
      style={{ ["--cable" as string]: hex ?? "var(--silk)", ["--led" as string]: ledHex(led) ?? "transparent" } as CSSProperties}
      title={summary}
      aria-label={summary}
      aria-pressed={selJack === j.id}
      onClick={() => v.onJack(j.id)}
      {...bind(j.id)}
    >
      <span className="nut">{d?.note && <span className="pip" />}</span>
      <span className="lbl">{label}</span>
    </button>
  );
}
