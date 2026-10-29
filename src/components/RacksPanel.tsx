import { useState } from "react";
import type { Rack } from "../lib/types";
import type { Library } from "../lib/library";
import { matchDataSheet, type SheetMatch } from "../lib/datasheet";
import { newId } from "../lib/util";
import type { Actions } from "../state";
import { ConfirmButton, ModuleSelect, useToast } from "./ui";

interface Props {
  racks: Rack[];
  library: Library;
  actions: Actions;
  onAddModule: () => void;
  onEditModule: (id: string) => void;
  onClose: () => void;
}

export function RacksPanel({ racks, library, actions, onAddModule, onEditModule, onClose }: Props) {
  const toast = useToast();
  const [pasteFor, setPasteFor] = useState<string | null>(null);

  const addRack = async () => {
    const r: Rack = { id: newId("r"), name: `Rack ${racks.length + 1}`, modules: [] };
    await actions.saveRack(r);
    setPasteFor(r.id);
  };

  return (
    <div className="stack">
      <div className="ed-head">
        <div>
          <div className="sect">Setup</div>
          <h3>My racks</h3>
        </div>
        <span className="dir">{library.size} modules in library</span>
      </div>
      <span className="hint">
        Modules in your racks are listed first when you pick what a jack is patched to. Paste a ModularGrid rack Data Sheet to fill a rack in one go.
      </span>

      {racks.length === 0 && <div className="empty-ed">No racks yet. Add one, then paste its ModularGrid Data Sheet or pick modules from the library.</div>}

      {racks.map((r) => (
        <RackCard
          key={r.id}
          rack={r}
          library={library}
          actions={actions}
          pasteOpen={pasteFor === r.id}
          onTogglePaste={() => setPasteFor(pasteFor === r.id ? null : r.id)}
          onEditModule={onEditModule}
          toast={toast}
        />
      ))}

      <div className="row">
        <button type="button" className="btn solid" onClick={addRack}>Add a rack</button>
        <button type="button" className="btn" onClick={onAddModule}>Add a module that's not listed</button>
      </div>
      <div className="ed-actions">
        <span />
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function RackCard({
  rack, library, actions, pasteOpen, onTogglePaste, onEditModule, toast,
}: {
  rack: Rack; library: Library; actions: Actions; pasteOpen: boolean;
  onTogglePaste: () => void; onEditModule: (id: string) => void; toast: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<(SheetMatch & { on: boolean })[] | null>(null);
  const save = (r: Rack) => actions.saveRack(r);

  const scan = () => {
    const found = matchDataSheet(text, [...library.values()]);
    setMatches(found.map((m) => ({ ...m, on: true })));
    if (!found.length) toast("No library modules found in that text");
  };

  const apply = async () => {
    if (!matches) return;
    const add = matches.filter((m) => m.on).flatMap((m) => Array(m.count).fill(m.id) as string[]);
    await save({ ...rack, modules: [...rack.modules, ...add] });
    toast(`Added ${add.length} module${add.length === 1 ? "" : "s"} to ${rack.name}`);
    setText("");
    setMatches(null);
    onTogglePaste();
  };

  return (
    <div className="rack">
      <div className="row">
        <label className="sr-only" htmlFor={`rn-${rack.id}`}>Rack name</label>
        <input
          id={`rn-${rack.id}`}
          type="text"
          maxLength={80}
          value={rack.name}
          onChange={(e) => save({ ...rack, name: e.target.value })}
          style={{ flex: 1, minWidth: 0, fontWeight: 600 }}
        />
        <ConfirmButton label="Delete" question="Delete this rack?" confirmLabel="Delete" onConfirm={() => actions.deleteRack(rack.id)} />
      </div>

      <div className="chiplist">
        {rack.modules.length === 0 && <span className="hint">Empty</span>}
        {rack.modules.map((id, i) => (
          <span key={`${id}-${i}`} className="mchip">
            <button type="button" style={{ padding: 0, fontSize: 12, color: "inherit" }} onClick={() => onEditModule(id)} title="Edit jack list">
              {library.get(id)?.name ?? id}
            </button>
            <button
              type="button"
              aria-label={`Remove ${library.get(id)?.name ?? id}`}
              onClick={() => save({ ...rack, modules: rack.modules.filter((_, k) => k !== i) })}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="field">
        <label htmlFor={`add-${rack.id}`} className="sr-only">Add a module</label>
        <ModuleSelect
          id={`add-${rack.id}`}
          value=""
          library={library}
          racks={[]}
          emptyLabel="Add a module from the library…"
          onChange={(v) => v && save({ ...rack, modules: [...rack.modules, v] })}
        />
      </div>

      <button type="button" className="linkbtn" onClick={onTogglePaste}>
        {pasteOpen ? "Hide ModularGrid paste" : "Paste a ModularGrid Data Sheet"}
      </button>
      {pasteOpen && (
        <div className="stack">
          <span className="hint">
            On ModularGrid, open your rack, choose Data Sheet, select the whole page and copy it. Paste it here.
          </span>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the Data Sheet text" aria-label="ModularGrid Data Sheet text" />
          <div className="row">
            <button type="button" className="btn" disabled={!text.trim()} onClick={scan}>Find modules</button>
          </div>
          {matches && matches.length > 0 && (
            <>
              <div className="matches">
                {matches.map((m, i) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      checked={m.on}
                      onChange={(e) => setMatches(matches.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))}
                    />
                    {m.name}
                    {m.count > 1 ? ` ×${m.count}` : ""}
                  </label>
                ))}
              </div>
              <span className="hint">Anything not found isn't in the library yet. Add it with "Add a module that's not listed".</span>
              <button type="button" className="btn solid" onClick={apply} style={{ alignSelf: "flex-start" }}>
                Add {matches.filter((m) => m.on).reduce((n, m) => n + m.count, 0)} to {rack.name}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
