import { useState } from "react";
import type { ModuleOverride, Signal } from "../lib/types";
import { SIGNALS } from "../lib/types";
import { guessSignal, SIGNAL_LABEL } from "../lib/signals";
import { toLibraryJson, type Library } from "../lib/library";
import { newId, normalise, nowIso } from "../lib/util";
import type { Actions } from "../state";
import { ConfirmButton, copyText, useToast } from "./ui";

interface Props {
  /** Existing module id, or null to add a module that isn't in the library. */
  moduleId: string | null;
  library: Library;
  actions: Actions;
  onClose: (savedId?: string) => void;
}

const lines = (s: string) => [...new Set(s.split("\n").map((x) => x.trim().slice(0, 24)).filter(Boolean))];

export function ModuleEditor({ moduleId, library, actions, onClose }: Props) {
  const toast = useToast();
  const m = moduleId ? library.get(moduleId) : undefined;
  const isNew = !m;
  const [name, setName] = useState(m?.name ?? "");
  const [maker, setMaker] = useState(m?.maker ?? "");
  const [hp, setHp] = useState(m?.hp ? String(m.hp) : "");
  const [ins, setIns] = useState((m?.inputs ?? []).join("\n"));
  const [outs, setOuts] = useState((m?.outputs ?? []).join("\n"));
  const [json, setJson] = useState("");
  const [sigs, setSigs] = useState<Record<string, Signal>>(() => ({ ...(m?.signals ?? {}) }));
  const typeOf = (j: string): Signal => sigs[j] ?? guessSignal(j);
  const allJacks = [...new Set([...lines(ins), ...lines(outs)])];

  /** Types that differ from the library's own (only those are stored as your edits). */
  const changedTypes = (jacks: string[]) => {
    const lib = m?.librarySignals ?? (m?.edited ? undefined : m?.signals);
    const out: Record<string, Signal> = {};
    for (const j of jacks) {
      const mine = typeOf(j), theirs = lib?.[j] ?? guessSignal(j);
      if (mine !== theirs) out[j] = mine;
    }
    return out;
  };

  const save = async () => {
    const inputs = lines(ins), outputs = lines(outs);
    if (isNew || m?.custom) {
      if (!name.trim() || !maker.trim()) return toast("Give the module a name and a maker.");
      const id = m?.id ?? `custom-${normalise(`${maker} ${name}`).replace(/ /g, "-").slice(0, 40)}-${newId("").slice(-4)}`;
      const signals = Object.fromEntries([...inputs, ...outputs].map((j) => [j, typeOf(j)]));
      const o: ModuleOverride = { id, custom: true, name: name.trim(), maker: maker.trim(), inputs, outputs, signals, updatedAt: nowIso() };
      const n = Number(hp);
      if (Number.isInteger(n) && n > 0) o.hp = n;
      await actions.saveOverride(o);
      toast(`Saved ${o.name}`);
      return onClose(id);
    }
    const changed = changedTypes([...inputs, ...outputs]);
    await actions.saveOverride({ id: m!.id, inputs, outputs, ...(Object.keys(changed).length ? { signals: changed } : {}), updatedAt: nowIso() });
    toast(`Saved ${m!.name}'s jacks`);
    onClose(m!.id);
  };

  const contribute = async () => {
    if (!m) return;
    const text = JSON.stringify(toLibraryJson(m), null, 2);
    setJson(text);
    toast((await copyText(text)) ? "Copied library JSON" : "Select and copy the JSON below");
  };

  return (
    <div className="stack">
      <div className="ed-head">
        <div>
          <div className="sect">{isNew ? "Add a module" : "Module jacks"}</div>
          <h3>{isNew ? "New module" : m!.name}</h3>
        </div>
        {m && <span className="dir">{m.maker}</span>}
      </div>

      {(isNew || m?.custom) && (
        <>
          <div className="field">
            <label htmlFor="mName">Module name</label>
            <input id="mName" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maths" />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 2, minWidth: 0 }}>
              <label htmlFor="mMaker">Maker</label>
              <input id="mMaker" type="text" maxLength={60} value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="e.g. Make Noise" />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor="mHp">Width (HP)</label>
              <input id="mHp" type="text" inputMode="numeric" value={hp} onChange={(e) => setHp(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="mIn">Inputs, one per line</label>
        <textarea id="mIn" rows={9} value={ins} onChange={(e) => setIns(e.target.value)} placeholder={"V/OCT\nFM\nTRIG"} />
      </div>
      <div className="field">
        <label htmlFor="mOut">Outputs, one per line</label>
        <textarea id="mOut" rows={5} value={outs} onChange={(e) => setOuts(e.target.value)} placeholder={"OUT"} />
        <span className="hint">Use the labels printed on the panel, up to 24 characters each.</span>
      </div>

      {allJacks.length > 0 && (
        <div className="field">
          <span className="fl" id="typesLbl">Jack types</span>
          <span className="hint">What each jack carries. This sets its colour when you pick jacks.</span>
          <div className="typegrid" role="group" aria-labelledby="typesLbl">
            {allJacks.map((j) => (
              <div key={j} className="typerow">
                <span className="mono" title={j}>{j}</span>
                <div className="typechips" role="radiogroup" aria-label={`${j} type`}>
                  {SIGNALS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={typeOf(j) === t}
                      className={`tchip sig-${t}`}
                      title={SIGNAL_LABEL[t]}
                      onClick={() => setSigs((x) => ({ ...x, [j]: t }))}
                    >
                      {SHORT[t]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {m && !m.custom && (
        <span className="hint">
          Source: {m.source}
          {m.confidence !== "high" ? " · not confirmed against the panel" : ""}
          {m.edited ? " · you've edited this list" : ""}
        </span>
      )}
      {m?.notes && <span className="hint">{m.notes}</span>}
      {m?.modulargrid?.url && (
        <a className="linkbtn" href={m.modulargrid.url} target="_blank" rel="noreferrer">See it on ModularGrid</a>
      )}

      <div className="ed-actions">
        <button type="button" className="btn" onClick={() => onClose()}>Cancel</button>
        <button type="button" className="btn solid" onClick={save}>Save jacks</button>
      </div>

      {m && (m.edited || m.custom) && (
        <div className="stack">
          <span className="hint">
            Share this with other Reliq users: copy it as library JSON and add it to the project's <span className="mono">modules/</span> folder (see CONTRIBUTING.md).
          </span>
          <div className="row">
            <button type="button" className="btn" onClick={contribute}>Copy as library JSON</button>
            {m.edited && !m.custom && (
              <ConfirmButton
                label="Reset to library version"
                question="Discard your edits?"
                confirmLabel="Reset"
                onConfirm={async () => (await actions.resetOverride(m.id), toast("Back to the library version"), onClose(m.id))}
              />
            )}
          </div>
          {json && <textarea className="copyfield" rows={10} readOnly value={json} onFocus={(e) => e.currentTarget.select()} />}
        </div>
      )}
    </div>
  );
}

const SHORT: Record<Signal, string> = { audio: "Audio", cv: "CV", pitch: "Pitch", gate: "Gate", clock: "Clock", any: "Any" };
