import { useLayoutEffect, useRef } from "react";
import type { JackDef, JackId, Patch, Zone } from "../lib/types";
import { CLOCK, CV_A, CV_B, GATES, MATRIX_IN, MATRIX_OUT, N16, RESET, ZONE_NAME, ZONE_TOTAL, trackOf } from "../lib/panel";
import { breakoutSummary, countZones, trackLabel } from "../lib/patch";
import { JackButton, type JackView } from "./JackButton";
import type { Library } from "../lib/library";
import type { Selection } from "../App";

interface Props {
  patch: Patch | null;
  library: Library;
  selection: Selection;
  zoneFilter: Zone | "all";
  moduleFilter: string;
  onJack: (id: JackId) => void;
  onTrack: (n: number) => void;
  onSettings: () => void;
}

/**
 * The Breakout Module front panel, laid out as printed: inputs are bare jacks,
 * outputs sit on a filled box. A redrawn, unofficial rendering.
 */
export function Faceplate({ patch, library, selection, zoneFilter, moduleFilter, onJack, onTrack, onSettings }: Props) {
  const selJack = selection.kind === "jack" ? selection.id : null;
  const selTrack = selection.kind === "track" ? selection.n : selJack ? trackOf(selJack) : null;

  const v: JackView = { patch, library, selJack, selTrack, zoneFilter, moduleFilter, onJack };
  const jack = (j: JackDef) => <JackButton key={j.id} j={j} v={v} />;
  const { wrapRef, fitRef, panelRef } = useFitScale();

  const cell = (zone: Zone, boxed: boolean, j: JackDef) => (
    <div key={j.id} className={`cell ${zone}${boxed ? " box" : ""}`}>
      {jack(j)}
    </div>
  );

  const counts = countZones(patch);
  const bsum = breakoutSummary(patch);

  return (
    <section className="rackwrap" aria-label="Breakout Module faceplate" ref={wrapRef}>
      <div className="panelfit" ref={fitRef}>
      <div className="panel" ref={panelRef}>
        <div className="rail"><span className="slot" /><span className="slot" /></div>
        <div className="frame audio">
          <span className="ftitle">Matrix</span>
          <div className="row16">{MATRIX_IN.map((j) => cell("audio", false, j))}</div>
          <div className="row16">{MATRIX_OUT.map((j) => cell("audio", true, j))}</div>
        </div>
        <div className="frame cv">
          <span className="ftitle">CV</span>
          <div className="row16 tracks">
            {N16.map((n) => {
              const t = patch?.tracks[n];
              const label = t ? trackLabel(patch, n) + (t.custom ? " (custom output routing)" : "") : `Track ${n}: not named`;
              return (
                <button
                  key={n}
                  type="button"
                  className={`trk${t ? " on" : ""}${selTrack === n ? " sel" : ""}`}
                  title={label}
                  aria-label={label}
                  aria-pressed={selection.kind === "track" && selection.n === n}
                  onClick={() => onTrack(n)}
                >
                  <b>T{n}</b>
                  {t?.name && <span>{t.name}</span>}
                </button>
              );
            })}
          </div>
          <div className="row16">
            {N16.map((_, i) => (
              <div key={i} className="cell cv box" style={{ gap: 9 }}>
                {jack(CV_A[i])}
                {jack(CV_B[i])}
              </div>
            ))}
          </div>
        </div>
        <div className="frame gate">
          <span className="ftitle">Gates</span>
          <div className="row16">{GATES.map((j) => cell("gate", true, j))}</div>
        </div>
        <div className="row16 bottom" style={{ paddingInline: 9.5 }}>
          <span className="slot" style={{ gridColumn: 2, justifySelf: "center", width: 38, height: 13 }} />
          <span className="paneltag" aria-hidden="true">Breakout</span>
          <button
            type="button"
            className={`brkset${bsum ? "" : " empty"}`}
            aria-label={`Breakout settings: ${bsum || "not noted"}`}
            onClick={onSettings}
          >
            {bsum || "Breakout settings ›"}
          </button>
          <div style={{ gridColumn: 15 }}>{cell("sync", true, CLOCK)}</div>
          <div style={{ gridColumn: 16 }}>{cell("sync", true, RESET)}</div>
        </div>
        <div className="rail"><span className="slot" /><span className="slot" /></div>
      </div>
      </div>
      <div className="legend">
        {(["audio", "cv", "gate", "sync"] as Zone[]).map((k) => (
          <span key={k}>
            <i style={{ background: `var(--${k === "sync" ? "silk-dim" : k})` }} />
            <b>{counts[k]}</b>/{ZONE_TOTAL[k]} {ZONE_NAME[k]}
          </span>
        ))}
        <span>Coloured plug = patched · dot = has notes · T1–T16 = name the Reliq track for that column</span>
      </div>
    </section>
  );
}

/**
 * Scale the panel down (never up) so all 16 columns fit the space it's given.
 * Uses a transform rather than CSS zoom: every browser reports positions inside a transformed
 * element the same way, which the cable drag relies on (Safari and Chrome disagree under zoom).
 */
function useFitScale() {
  const wrapRef = useRef<HTMLElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const wrap = wrapRef.current, fit = fitRef.current, panel = panelRef.current;
    if (!wrap || !fit || !panel) return;
    const apply = () => {
      const w = panel.offsetWidth, h = panel.offsetHeight; // layout size, unaffected by the transform
      const z = Math.min(1, wrap.clientWidth / w);
      panel.style.transform = z < 1 ? `scale(${z})` : "";
      fit.style.width = `${Math.floor(w * z)}px`;
      fit.style.height = `${Math.ceil(h * z)}px`;
      panel.dataset.scale = String(Math.round(z * 1000) / 1000);
    };
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    apply();
    return () => ro.disconnect();
  }, []);
  return { wrapRef, fitRef, panelRef };
}
