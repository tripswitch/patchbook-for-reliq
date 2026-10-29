import type { Patch, Rack } from "../lib/types";
import { CV_STANDARDS, JACKS, trackJacks } from "../lib/panel";
import { targetText } from "../lib/patch";
import { GUESS_PATTERNS, guessJack, type Library } from "../lib/library";
import type { Actions } from "../state";
import { ConfirmButton, ModuleSelect, useToast } from "./ui";

interface Props {
  patch: Patch;
  n: number;
  library: Library;
  racks: Rack[];
  actions: Actions;
  onDone: () => void;
  onJack: (id: string) => void;
}

export function TrackEditor({ patch, n, library, racks, actions, onDone, onJack }: Props) {
  const toast = useToast();
  const t = patch.tracks[n] ?? {};
  const set = (field: "name" | "std" | "mod" | "custom", v: string | boolean) => actions.setTrack(patch.id, n, field, v);

  const fill = () => {
    if (!t.mod) return;
    const guesses = {
      [`cv${n}a`]: guessJack(library, t.mod, GUESS_PATTERNS.a),
      [`g${n}`]: guessJack(library, t.mod, GUESS_PATTERNS.g),
    };
    const c = actions.fillTrackJacks(patch.id, n, t.mod, guesses);
    toast(c ? `${c} jack${c > 1 ? "s" : ""} set to ${library.get(t.mod)?.name}` : "All three already have a module");
  };

  return (
    <div className="stack">
      <div className="ed-head">
        <div>
          <div className="sect" style={{ color: "var(--cv)" }}>Reliq track</div>
          <h3>Track {n}</h3>
        </div>
        <span className="dir">A{n} · B{n} · Gate {n}</span>
      </div>

      <div className="field">
        <label htmlFor="fTName">Track name</label>
        <input id="fTName" type="text" maxLength={40} placeholder="e.g. Plaits bass" value={t.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        <span className="hint">
          With this track's output set to CV on Reliq, A{n} sends pitch, B{n} velocity or mod, and Gate {n} the gate. Naming the track labels all three.
        </span>
      </div>

      <div className="field">
        <label htmlFor="fTStd">CV/Gate standard</label>
        <select id="fTStd" value={t.std ?? ""} onChange={(e) => set("std", e.target.value)}>
          <option value="">Not noted</option>
          {CV_STANDARDS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="hint">Set in Reliq's Track Settings. 1V/Oct is right for Eurorack.</span>
      </div>

      <div className="field">
        <label className="check">
          <input type="checkbox" checked={!!t.custom} onChange={(e) => set("custom", e.target.checked)} /> Uses a custom output routing
        </label>
        <span className="hint">
          Tick this if the track's voices or drum sounds go to other CV and Gate jacks. A{n}, B{n} and Gate {n} then stop being labelled as this track.
        </span>
      </div>

      <div className="field">
        <label htmlFor="fTMod">Voice module</label>
        <ModuleSelect id="fTMod" value={t.mod} library={library} racks={racks} onChange={(v) => set("mod", v)} />
        <button type="button" className="btn" disabled={!t.mod} onClick={fill} style={{ alignSelf: "flex-start" }}>
          Patch A{n}, B{n} and Gate {n} to it
        </button>
        <span className="hint">Fills in the module on any of the three jacks that don't have one yet, and picks its pitch and gate jacks where it can.</span>
      </div>

      <div className="trkjacks">
        {trackJacks(n).map((id) => (
          <button key={id} type="button" className="tj" onClick={() => onJack(id)}>
            <b>{JACKS[id].name}</b>
            <span>{targetText(library, patch.jacks[id]) || "Not patched"}</span>
          </button>
        ))}
      </div>

      <div className="ed-actions">
        <ConfirmButton
          label="Clear track"
          question={`Clear Track ${n}? Its jacks keep their connections.`}
          confirmLabel="Clear"
          disabled={!patch.tracks[n]}
          onConfirm={() => (actions.clearTrack(patch.id, n), toast("Track cleared"))}
        />
        <button type="button" className="btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
