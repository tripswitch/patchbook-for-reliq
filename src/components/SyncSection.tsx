import { useEffect, useState } from "react";
import { formatKey, sync, syncAvailable, syncLink, SyncError, type Prejoin, type SyncStatus } from "../lib/sync";
import { ConfirmButton, copyText, downloadFile, useToast } from "./ui";

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(sync.current);
  useEffect(() => sync.subscribe(setS), []);
  return s;
}

function ago(iso?: string) {
  if (!iso) return "not yet";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleString();
}

export function statusText(s: SyncStatus): string {
  switch (s.state) {
    case "syncing":
      return "Syncing…";
    case "idle":
      return `Synced ${ago(s.lastSynced)}${s.note ? `. ${s.note}` : ""}`;
    case "offline":
      return `Offline. Changes will sync when you're back online (last synced ${ago(s.lastSynced)}).`;
    case "error":
      return `Couldn't sync: ${s.message}`;
    default:
      return "";
  }
}

/** "Sync between devices" block in the Backup & sync panel. */
export function SyncSection({ empty = false }: { empty?: boolean }) {
  const toast = useToast();
  const status = useSyncStatus();
  const [joining, setJoining] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [, tick] = useState(0);

  // Keep "synced 2 minutes ago" fresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!syncAvailable) return null;
  const key = sync.syncKey;

  const startNew = async () => {
    await sync.enable();
    toast("Sync is on. Copy the link to add your other devices.");
  };

  const copyLink = async () => {
    if (!key) return;
    toast((await copyText(syncLink(key))) ? "Link copied. Open it on your other device." : "Couldn't copy. Show the key and type it on the other device.");
  };

  if (status.state === "off" || !key)
    return (
      <>
        <div className="sect">Sync between devices</div>
        {empty ? (
          <>
            <span className="hint">Already using Patchbook on another device? Paste its sync link here to bring your patches across.</span>
            <JoinForm />
            {!confirmNew ? (
              <button type="button" className="linkbtn" onClick={() => setConfirmNew(true)}>
                First device? Start a new sync space instead
              </button>
            ) : (
              <div className="banner">
                <span className="grow">A new sync space starts empty and isn't linked to your other devices. To get your patches, paste a link above instead.</span>
                <button type="button" className="btn" onClick={startNew}>Start a new space</button>
                <button type="button" className="btn" onClick={() => setConfirmNew(false)}>Cancel</button>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="hint">
              Keep your patches, racks and module edits the same on your phone, iPad and computers. There's no account: a private sync key
              links your devices. If another device already syncs, join it so you share the same patches.
            </span>
            {!joining ? (
              <div className="row">
                <button type="button" className="btn solid" onClick={startNew}>Turn on sync</button>
                <button type="button" className="btn" onClick={() => setJoining(true)}>Join another device</button>
              </div>
            ) : (
              <JoinForm onCancel={() => setJoining(false)} />
            )}
          </>
        )}
      </>
    );

  return (
    <>
      <div className="sect">Sync between devices</div>
      <span className={`hint${status.state === "error" ? " warnhint" : ""}`} role="status" data-sync-state={status.state}>
        <span className={`syncdot ${status.state}`} aria-hidden="true" /> {statusText(status)}
      </span>
      <span className="hint">
        Sync space <b className="mono">{key.slice(0, 4)}</b>. Every device showing the same four characters shares the same patches.
      </span>
      <div className="row">
        <button type="button" className="btn solid" onClick={copyLink}>Copy link for another device</button>
        <button type="button" className="btn" onClick={() => void sync.syncNow()} disabled={status.state === "syncing"}>Sync now</button>
        <button type="button" className="btn" onClick={() => setShowKey((v) => !v)}>{showKey ? "Hide key" : "Show key"}</button>
      </div>
      {showKey && (
        <input className="copyfield" readOnly value={formatKey(key)} onFocus={(e) => e.currentTarget.select()} aria-label="Sync key" />
      )}
      <span className="hint">
        Treat the link and key like a password: anyone who has them can see, change and delete your patches. Only open sync links you made
        yourself; to share a patch with someone, use Copy share link below. Patches are encrypted on your device before they're uploaded, so
        the server only ever holds scrambled data. Changes sync within a few seconds while the app is open; edits made offline catch up later.
        If the same patch is edited on two devices, the most recent edit wins.
      </span>
      {switching ? (
        <div className="welcome-join">
          <strong>Switch to another device's sync</strong>
          <span className="hint">Use this if your devices ended up in different sync spaces. Everything on this device is merged into the other space.</span>
          <JoinForm onCancel={() => setSwitching(false)} onJoined={() => setSwitching(false)} />
        </div>
      ) : (
        <button type="button" className="linkbtn" onClick={() => setSwitching(true)}>
          Switch to another device's sync space
        </button>
      )}
      <div className="row">
        <ConfirmButton
          label="Stop syncing on this device"
          question="Stop syncing here? Your patches stay on this device and your others."
          confirmLabel="Stop syncing"
          onConfirm={() => void sync.disable().then(() => toast("Sync is off on this device"))}
        />
        <ConfirmButton
          label="Delete my synced data"
          question="Delete everything stored on the server for this sync space? Your devices keep their own copies."
          confirmLabel="Delete from server"
          onConfirm={async () => {
            try {
              const n = await sync.deleteRemote();
              toast(`Deleted ${n} item${n === 1 ? "" : "s"} from the server. Sync is off on this device.`);
            } catch (e) {
              toast(e instanceof Error ? `Couldn't delete: ${e.message}` : "Couldn't delete. Try again when you're online.");
            }
          }}
        />
      </div>
      <span className="hint">
        Deleting removes this sync space from the server and turns sync off here. Stop syncing on your other devices too, or the next change
        on one of them uploads its patches again. Sync spaces nobody has used for 12 months are deleted automatically.
      </span>
    </>
  );
}

/** Offered after joining a sync space: put back exactly what was on this device before. */
export function PrejoinNotice() {
  const toast = useToast();
  const [p, setP] = useState<Prejoin | null>(null);
  const status = useSyncStatus();
  useEffect(() => {
    void sync.prejoin().then(setP);
  }, [status.state]);
  if (!p) return null;
  const when = new Date(p.at).toLocaleString();
  const counts = `${p.backup.patches.length} patch${p.backup.patches.length === 1 ? "" : "es"}, ${p.backup.racks.length} rack${p.backup.racks.length === 1 ? "" : "s"}`;
  return (
    <div className="welcome-join" role="status">
      <strong>You joined a sync space on {when}</strong>
      <span className="hint">
        Patchbook kept a copy of what was on this device before ({counts}). If that sync link wasn't yours, or something looks wrong, undo
        it: this device leaves that sync space and goes back to exactly what it had{p.previousKey ? ", syncing with your own space again" : ""}.
      </span>
      <div className="row">
        <ConfirmButton
          label="Undo joining"
          question="Leave this sync space and restore what was here before?"
          confirmLabel="Undo"
          onConfirm={async () => {
            await sync.undoJoin();
            setP(null);
            toast("Restored what was on this device before joining");
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => downloadFile(`patchbook-before-joining-${p.at.slice(0, 10)}.json`, JSON.stringify(p.backup, null, 2))}
        >
          Download that copy
        </button>
        <button type="button" className="btn" onClick={() => void sync.dismissPrejoin().then(() => setP(null))}>
          All good, forget it
        </button>
      </div>
    </div>
  );
}

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Paste a sync link (or key) from another device to join its sync space. */
export function JoinForm({ onCancel, onJoined }: { onCancel?: () => void; onJoined?: () => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canPaste = typeof navigator.clipboard?.readText === "function";

  const join = async (value: string) => {
    setError("");
    setBusy(true);
    try {
      await sync.join(value);
      setTyped("");
      toast("Joined. Your patches from other devices are on their way.");
      onJoined?.();
    } catch (err) {
      setError(err instanceof SyncError ? err.message : "Couldn't join with that link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack joinform" style={{ gap: 8 }} onSubmit={(e) => (e.preventDefault(), void join(typed))}>
      <label className="fl" htmlFor="sync-key">Sync link or key from your other device</label>
      <div className="row nowrap">
        <input
          id="sync-key"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Paste the link, or type the key"
          value={typed}
          onChange={(e) => (setTyped(e.target.value), setError(""))}
          style={{ flex: 1 }}
        />
        {canPaste && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                const t = await navigator.clipboard.readText();
                setTyped(t);
                if (t.trim()) void join(t);
              } catch {
                setError("Couldn't read the clipboard. Press and hold in the box and choose Paste.");
              }
            }}
          >
            Paste
          </button>
        )}
      </div>
      <div className="row">
        <button type="submit" className="btn solid" disabled={busy || !typed.trim()}>{busy ? "Joining…" : "Join"}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
      {error && <span className="hint warnhint" role="alert">{error}</span>}
      <span className="hint">
        Only join with a link or key you made yourself: whoever made it can see, change and delete everything you sync. On a synced device:
        Backup &amp; sync → Copy link for another device.
        {isStandalone() ? " Apps added to the Home Screen keep their own storage, so join here even if Safari already syncs." : ""}
        {" "}Anything already on this device is kept and merged in.
      </span>
    </form>
  );
}
