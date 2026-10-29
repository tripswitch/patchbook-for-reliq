import { useState } from "react";
import type { PatchbookState, Actions } from "../state";
import { newestFirst } from "../state";
import { ConfirmButton, useToast } from "./ui";

const SAVE_TEXT = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" } as const;

export function PatchBar({ state, actions }: { state: PatchbookState; actions: Actions }) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const p = state.current;
  const sorted = [...state.patches].sort(newestFirst);

  const saveName = () => {
    const v = draft.trim();
    if (!v || !p) return;
    actions.renamePatch(p.id, v);
    setRenaming(false);
    toast("Renamed");
  };

  return (
    <>
      <div className="patchbar">
        <label htmlFor="patchSel">Patch</label>
        <select id="patchSel" value={p?.id ?? ""} disabled={!p} onChange={(e) => actions.selectPatch(e.target.value)}>
          {!p && <option>No patches</option>}
          {sorted.map((x) => <option key={x.id} value={x.id}>{x.name || "Untitled"}</option>)}
        </select>
        <button type="button" className="btn" onClick={() => (actions.createPatch(`Patch ${state.patches.length + 1}`), toast("New patch started"))}>New</button>
        <button type="button" className="btn" disabled={!p} onClick={() => p && (actions.createPatch(`${p.name} copy`, p), toast("Patch duplicated"))}>Duplicate</button>
        <button type="button" className="btn" disabled={!p} onClick={() => p && (setDraft(p.name), setRenaming(true))}>Rename</button>
        <ConfirmButton
          label="Delete"
          disabled={!p}
          question={`Delete “${p?.name ?? ""}”?`}
          confirmLabel="Delete"
          onConfirm={() => p && (actions.deletePatch(p.id), toast("Patch deleted"))}
        />
        <span className="status" aria-live="polite">{SAVE_TEXT[state.saveState]}</span>
      </div>
      {renaming && (
        <div className="patchbar">
          <label htmlFor="renameInput" className="sr-only">Patch name</label>
          <input
            id="renameInput"
            type="text"
            autoFocus
            maxLength={60}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? saveName() : e.key === "Escape" && setRenaming(false))}
            style={{ width: "min(320px,100%)" }}
          />
          <button type="button" className="btn solid" onClick={saveName}>Save name</button>
          <button type="button" className="btn" onClick={() => setRenaming(false)}>Cancel</button>
        </div>
      )}
    </>
  );
}
