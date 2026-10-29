import type { Patch } from "../lib/types";
import { CLOCK_DIVISIONS, GATE_RANGES, RESET_MODES } from "../lib/panel";
import type { Actions } from "../state";

export function PatchSettings({ patch, actions }: { patch: Patch; actions: Actions }) {
  const b = patch.brk;
  return (
    <div className="stack">
      <div className="empty-ed">
        <strong>Pick a jack or track</strong>
        Tap a jack to patch it, or drag from a jack onto a module. Tap a track box (T1–T16) to name a Reliq track.
      </div>

      <div className="field">
        <label htmlFor="patchNotes">Patch notes</label>
        <textarea
          id="patchNotes"
          maxLength={4000}
          placeholder="What is this patch for? Tempo, Reliq project name, anything you want to remember."
          value={patch.notes}
          onChange={(e) => actions.setNotes(patch.id, e.target.value)}
        />
      </div>

      <div className="sect">Breakout settings</div>
      <span className="hint">These live on Reliq under Device Settings › Breakout Module. Note what they were set to for this patch.</span>

      <div className="field">
        <label htmlFor="bClock">Clock Out</label>
        <input id="bClock" type="text" list="clockList" maxLength={24} placeholder="e.g. 1/16" value={b.clock ?? ""}
          onChange={(e) => actions.setBreakout(patch.id, "clock", e.target.value.trim())} />
        <datalist id="clockList">{CLOCK_DIVISIONS.map((v) => <option key={v} value={v} />)}</datalist>
        <span className="hint">Anything from 1 bar down to 1/96 (24 PPQN).</span>
      </div>

      <div className="field">
        <label htmlFor="bReset">Reset Out</label>
        <select id="bReset" value={b.reset ?? ""} onChange={(e) => actions.setBreakout(patch.id, "reset", e.target.value)}>
          <option value="">Not noted</option>
          {RESET_MODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor="bGate">Gate output range</label>
        <select id="bGate" value={b.gate ?? ""} onChange={(e) => actions.setBreakout(patch.id, "gate", e.target.value)}>
          <option value="">Not noted</option>
          {GATE_RANGES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </div>
    </div>
  );
}
