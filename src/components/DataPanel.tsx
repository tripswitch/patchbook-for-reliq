import { useRef, useState } from "react";
import type { PatchbookState, Actions } from "../state";
import { ImportError, makeBackup, parseBackup } from "../lib/backup";
import { encodeShare, MAX_SHARE_TOKEN, shareUrl } from "../lib/share";
import { customModulesUsed, patchAsText } from "../lib/patch";
import { copyText, downloadFile, useToast } from "./ui";
import { PrejoinNotice, SyncSection } from "./SyncSection";
import { syncAvailable } from "../lib/sync";

export function DataPanel({ state, actions, onClose }: { state: PatchbookState; actions: Actions; onClose: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const p = state.current;
  const stamp = new Date().toISOString().slice(0, 10);

  const exportAll = () => {
    const b = makeBackup(state.patches, state.racks, state.overrides);
    downloadFile(`patchbook-backup-${stamp}.json`, JSON.stringify(b, null, 2));
    toast("Backup downloaded");
  };

  const exportPatch = () => {
    if (!p) return;
    const custom = state.overrides.filter((o) => customModulesUsed(p, state.library).includes(o.id));
    const b = makeBackup([p], [], custom);
    downloadFile(`${p.name.replace(/[^\w-]+/g, "-").toLowerCase() || "patch"}-${stamp}.json`, JSON.stringify(b, null, 2));
    toast("Patch downloaded");
  };

  const importFile = async (f: File) => {
    setError("");
    try {
      const b = parseBackup(await f.text());
      await actions.importBackup(b);
      toast(`Imported ${b.patches.length} patch${b.patches.length === 1 ? "" : "es"}, ${b.racks.length} rack${b.racks.length === 1 ? "" : "s"}`);
    } catch (e) {
      setError(e instanceof ImportError ? e.message : "Couldn't read that file. Check it's a Patchbook backup.");
    }
  };

  const share = async () => {
    if (!p) return;
    const custom = state.overrides.filter((o) => customModulesUsed(p, state.library).includes(o.id));
    const token = await encodeShare(p, custom);
    if (token.length > MAX_SHARE_TOKEN) return toast("This patch is too big for a link. Use Download patch file instead.");
    const url = shareUrl(token);
    setLink(url);
    toast((await copyText(url)) ? "Share link copied" : "Select and copy the link below");
  };

  const asText = async () => {
    if (!p) return;
    const t = patchAsText(p, state.library);
    setText(t);
    toast((await copyText(t)) ? "Copied to clipboard" : "Select and copy the text below");
  };

  return (
    <div className="stack">
      <div className="ed-head">
        <div>
          <div className="sect">Your data</div>
          <h3>{syncAvailable ? "Backup & sync" : "Backup & share"}</h3>
        </div>
      </div>
      <span className="hint">
        Everything is stored in this browser on this device{syncAvailable ? ", and on your other devices if you turn on sync" : ""}. Download a
        backup now and then too.
      </span>

      <PrejoinNotice />
      <SyncSection empty={!state.patches.length && !state.racks.length} />

      <div className="sect">Backup</div>
      <div className="row">
        <button type="button" className="btn solid" onClick={exportAll} disabled={!state.patches.length && !state.racks.length}>
          Download full backup
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import a backup</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <span className="hint">Importing adds the file's patches, racks and module edits. Anything with the same id is replaced by the file's copy.</span>
      {error && <span className="hint warnhint" role="alert">{error}</span>}

      <div className="sect">This patch{p ? `: ${p.name}` : ""}</div>
      <div className="row">
        <button type="button" className="btn" onClick={share} disabled={!p}>Copy share link</button>
        <button type="button" className="btn" onClick={exportPatch} disabled={!p}>Download patch file</button>
        <button type="button" className="btn" onClick={asText} disabled={!p}>Copy as text</button>
      </div>
      <span className="hint">The share link holds the whole patch inside the link itself; nothing is uploaded. Anyone with the link can import a copy.</span>
      {link && <textarea className="copyfield" rows={3} readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />}
      {text && <textarea className="copyfield" rows={10} readOnly value={text} onFocus={(e) => e.currentTarget.select()} aria-label="Patch as text" />}

      <div className="ed-actions">
        <span />
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
