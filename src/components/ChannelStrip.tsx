import type { JackId, Patch, Zone } from "../lib/types";
import { CLOCK, CV_A, CV_B, GATES, MATRIX_IN, MATRIX_OUT, N16, RESET, ZONE_NAME, ZONE_TOTAL, trackOf } from "../lib/panel";
import { breakoutSummary, countZones, trackLabel } from "../lib/patch";
import type { Library } from "../lib/library";
import type { Selection } from "../App";
import { JackButton, type JackView } from "./JackButton";

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
 * The same 82 jacks for small screens, one row per channel number: Matrix IN and OUT,
 * then the track's A, B and Gate. Sixteen columns can't fit a phone at a size you can tap.
 */
export function ChannelStrip({ patch, library, selection, zoneFilter, moduleFilter, onJack, onTrack, onSettings }: Props) {
  const selJack = selection.kind === "jack" ? selection.id : null;
  const selTrack = selection.kind === "track" ? selection.n : selJack ? trackOf(selJack) : null;
  const v: JackView = { patch, library, selJack, selTrack, zoneFilter, moduleFilter, onJack };
  const counts = countZones(patch);
  const bsum = breakoutSummary(patch);

  return (
    <section className="stripwrap" aria-label="Breakout Module jacks by channel">
      <div className="strip">
      <div className="strip-head" aria-hidden="true">
        <span />
        <span className="z-audio">In</span>
        <span className="z-audio">Out</span>
        <span className="z-cv">Track</span>
        <span className="z-cv">A</span>
        <span className="z-cv">B</span>
        <span className="z-gate">Gate</span>
      </div>
      {N16.map((n, i) => {
        const t = patch?.tracks[n];
        return (
          <div key={n} className={`strip-row${selTrack === n ? " sel" : ""}`} data-channel={n}>
            <span className="strip-n" aria-hidden="true">{n}</span>
            <div className="cell audio"><JackButton j={MATRIX_IN[i]} v={v} label="IN" /></div>
            <div className="cell audio box"><JackButton j={MATRIX_OUT[i]} v={v} label="OUT" /></div>
            {/* The track sits with A, B and Gate, which it drives; the Matrix is routed separately. */}
            <button
              type="button"
              className={`strip-trk${t ? " on" : ""}`}
              aria-label={t ? trackLabel(patch, n) : `Track ${n}: not named`}
              aria-pressed={selection.kind === "track" && selection.n === n}
              onClick={() => onTrack(n)}
            >
              <b>T{n}</b>
              {t?.name && <span>{t.name}</span>}
            </button>
            <div className="cell cv box"><JackButton j={CV_A[i]} v={v} label="A" /></div>
            <div className="cell cv box"><JackButton j={CV_B[i]} v={v} label="B" /></div>
            <div className="cell gate box"><JackButton j={GATES[i]} v={v} label="GATE" /></div>
          </div>
        );
      })}
      <div className="strip-row strip-sync">
        <button type="button" className={`brkset${bsum ? "" : " empty"}`} aria-label={`Breakout settings: ${bsum || "not noted"}`} onClick={onSettings}>
          {bsum || "Breakout settings ›"}
        </button>
        <div className="cell sync box"><JackButton j={CLOCK} v={v} label="CLK" /></div>
        <div className="cell sync box"><JackButton j={RESET} v={v} label="RST" /></div>
      </div>
      </div>
      <div className="legend">
        {(["audio", "cv", "gate", "sync"] as Zone[]).map((k) => (
          <span key={k}>
            <i style={{ background: `var(--${k === "sync" ? "silk-dim" : k})` }} />
            <b>{counts[k]}</b>/{ZONE_TOTAL[k]} {ZONE_NAME[k]}
          </span>
        ))}
      </div>
    </section>
  );
}
