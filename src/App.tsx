import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JackId, SharePayload, Zone } from "./lib/types";
import { usePatchbook } from "./state";
import { decodeShare, SHARE_PREFIX } from "./lib/share";
import { ImportError, parseBackup } from "./lib/backup";
import { formatKey, isValidKey, normaliseKey, sync, syncAvailable, SyncError, SYNC_LINK_PREFIX } from "./lib/sync";
import { JoinForm, statusText, useSyncStatus } from "./components/SyncSection";
import { ToastProvider, useToast } from "./components/ui";
import { Faceplate } from "./components/Faceplate";
import { PatchBar } from "./components/PatchBar";
import { JackEditor } from "./components/JackEditor";
import { TrackEditor } from "./components/TrackEditor";
import { PatchSettings } from "./components/PatchSettings";
import { ModuleEditor } from "./components/ModuleEditor";
import { RacksPanel } from "./components/RacksPanel";
import { DataPanel } from "./components/DataPanel";
import { ConnectionSheet } from "./components/ConnectionSheet";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { ISSUES_URL } from "./lib/links";
import { ChannelStrip } from "./components/ChannelStrip";
import { CableDragProvider } from "./components/CableDrag";
import { nextJack, prevJack } from "./lib/flow";
import { countZones, customColours } from "./lib/patch";

export type Selection =
  | { kind: "none" }
  | { kind: "jack"; id: JackId; from?: JackId | null; dropped?: boolean }
  | { kind: "track"; n: number }
  | { kind: "module"; id: string | null; back: Selection }
  | { kind: "data" }
  | { kind: "privacy" };

export function App() {
  return (
    <ToastProvider>
      <Patchbook />
    </ToastProvider>
  );
}

function Patchbook() {
  const toast = useToast();
  const { state, actions } = usePatchbook();
  const [sel, setSel] = useState<Selection>({ kind: "none" });
  const [zoneFilter, setZoneFilter] = useState<Zone | "all">("all");
  const [moduleFilter, setModuleFilter] = useState("");
  const [shared, setShared] = useState<SharePayload | null>(null);
  const [shareError, setShareError] = useState("");
  const [update, setUpdate] = useState<ServiceWorkerRegistration | null>(null);
  const [show, setShow] = useShowPrefs();
  const vp = useViewport();
  const sheetRef = useRef<HTMLElement>(null);
  const [syncInvite, setSyncInvite] = useState<string | null>(null);
  const syncStatus = useSyncStatus();

  /* A share link opens the app with #share=… */
  useEffect(() => {
    const read = async () => {
      if (!location.hash.startsWith(SHARE_PREFIX)) return;
      const token = location.hash.slice(SHARE_PREFIX.length);
      history.replaceState(null, "", location.pathname + location.search);
      try {
        setShared(await decodeShare(token));
        setShareError("");
      } catch (e) {
        setShareError(e instanceof ImportError ? e.message : "That share link couldn't be opened.");
      }
    };
    void read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  /* A sync link opens the app with #sync=KEY. The key is removed from the address bar straight away. */
  useEffect(() => {
    const read = () => {
      if (!location.hash.startsWith(SYNC_LINK_PREFIX)) return;
      const key = normaliseKey(location.hash.slice(SYNC_LINK_PREFIX.length));
      history.replaceState(null, "", location.pathname + location.search);
      if (!syncAvailable) return;
      if (!isValidKey(key)) return setShareError("That sync link is incomplete. Copy it again from your other device.");
      if (sync.syncKey === key) return toast("This device is already syncing");
      setSyncInvite(key);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [toast]);

  useEffect(() => {
    const h = (e: Event) => setUpdate((e as CustomEvent<ServiceWorkerRegistration>).detail);
    window.addEventListener("patchbook:update", h);
    return () => window.removeEventListener("patchbook:update", h);
  }, []);

  /* Changing patch closes jack and track editors, which belong to the old patch. */
  useEffect(() => {
    setSel((s) => (s.kind === "jack" || s.kind === "track" ? { kind: "none" } : s));
  }, [state.currentId]);

  /* Keyboard: ] next jack, [ previous, Esc closes. Not while typing. */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (sel.kind !== "jack" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "]") (e.preventDefault(), go(nextJack(sel.id), sel.id));
      else if (e.key === "[") (e.preventDefault(), go(prevJack(sel.id), sel.id));
      else if (e.key === "Escape" && !document.documentElement.classList.contains("cable-dragging")) setSel({ kind: "none" });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const asSheet = vp !== "wide" && (sel.kind === "jack" || sel.kind === "track" || sel.kind === "module");

  /* As a bottom sheet, the editor covers the lower part of the screen: keep the selected jack (or channel) visible above it. */
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!asSheet || !sheet) {
      document.documentElement.style.removeProperty("--sheet-h");
      return;
    }
    const place = () => {
      document.documentElement.style.setProperty("--sheet-h", `${sheet.offsetHeight}px`);
      const sel0 = sel.kind === "jack" ? document.querySelector(`[data-jack="${sel.id}"]`) : sel.kind === "track" ? document.querySelector(`[data-channel="${sel.n}"], .trk[aria-pressed="true"]`) : null;
      if (!sel0) return;
      const r = sel0.getBoundingClientRect();
      // Use the sheet's resting position, not where its slide-in animation has it now.
      const top = window.innerHeight - sheet.offsetHeight;
      if (r.bottom > top - 12) window.scrollBy({ top: r.bottom - top + 24, behavior: "smooth" });
      else if (r.top < 8) window.scrollBy({ top: r.top - 16, behavior: "smooth" });
    };
    place();
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--sheet-h", `${sheet.offsetHeight}px`));
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [asSheet, sel.kind === "jack" ? sel.id : sel.kind === "track" ? sel.n : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = state.current;
  const go = (id: JackId | null, from: JackId) => id && setSel({ kind: "jack", id, from });
  const toggle = (next: Selection) => setSel((s) => (s.kind === next.kind ? { kind: "none" } : next));

  /* The demo patch (docs/demo-backup.json), loaded on demand so it stays out of the main bundle. */
  const loadDemo = async () => {
    try {
      const raw = (await import("../docs/demo-backup.json")).default;
      await actions.importBackup(parseBackup(JSON.stringify(raw)));
      toast("Demo patch loaded, with a demo rack. Delete them any time.");
    } catch {
      toast("Couldn't load the demo patch. Reload and try again.");
    }
  };

  /* My racks: a view in the main area, toggled like the panel and the connection sheet. */
  const racksRef = useRef<HTMLElement>(null);
  const showRacks = () => {
    setShow((v) => ({ ...v, racks: true }));
    requestAnimationFrame(() => racksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const racksView = show.racks && (
    <section className="card racksview" ref={racksRef} aria-label="My racks">
      <RacksPanel
        racks={state.racks}
        library={state.library}
        actions={actions}
        onAddModule={() => setSel({ kind: "module", id: null, back: { kind: "none" } })}
        onEditModule={(id) => setSel({ kind: "module", id, back: { kind: "none" } })}
        onClose={() => setShow((v) => ({ ...v, racks: false }))}
      />
    </section>
  );

  const side = () => {
    switch (sel.kind) {
      case "privacy":
        return <PrivacyPanel onClose={() => setSel({ kind: "none" })} />;
      case "data":
        return <DataPanel state={state} actions={actions} onClose={() => setSel({ kind: "none" })} />;
      case "module":
        return <ModuleEditor key={sel.id ?? "new"} moduleId={sel.id} library={state.library} actions={actions} onClose={() => setSel(sel.back)} />;
    }
    if (!p) return null;
    if (sel.kind === "jack")
      return (
        <JackEditor
          key={sel.id}
          patch={p}
          jackId={sel.id}
          library={state.library}
          racks={state.racks}
          actions={actions}
          cameFrom={sel.from}
          dropped={sel.dropped}
          customColours={customColours(state.patches)}
          onDone={() => setSel({ kind: "none" })}
          onGo={go}
          onTrack={(n) => setSel({ kind: "track", n })}
          onEditModule={(id) => setSel({ kind: "module", id, back: sel })}
        />
      );
    if (sel.kind === "track")
      return (
        <TrackEditor
          key={sel.n}
          patch={p}
          n={sel.n}
          library={state.library}
          racks={state.racks}
          actions={actions}
          onDone={() => setSel({ kind: "none" })}
          onJack={(id) => setSel({ kind: "jack", id })}
        />
      );
    return <PatchSettings patch={p} actions={actions} />;
  };

  if (!state.ready) return <div className="wrap"><p className="hint">Opening your patchbook…</p></div>;

  return (
    <CableDragProvider
      enabled={vp !== "narrow" && !!p}
      patch={p}
      library={state.library}
      racks={state.racks}
      onDrop={(id, mod, to) => {
        if (!p) return;
        actions.setJackModule(p.id, id, mod);
        if (to) actions.setJackField(p.id, id, "to", to);
        setShow((v) => ({ ...v, panel: true }));
        setSel({ kind: "jack", id, dropped: !to });
        const name = state.library.get(mod)?.name ?? "Module";
        toast(to ? `Patched to ${name} › ${to}` : `${name} patched. Now pick its jack.`);
      }}
    >
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Patchbook <span>for Reliq</span></h1>
          <p>Click any jack to log what's plugged into it. Matrix inputs carry audio into the Reliq; everything else is an output from it.</p>
        </div>
        <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
          <PatchBar state={state} actions={actions} />
          <div className="nav">
            <button type="button" className="btn" aria-pressed={sel.kind === "data"} onClick={() => toggle({ kind: "data" })}>
              {syncAvailable ? "Backup & sync" : "Backup & share"}
              {sync.enabled && <span className={`syncdot ${syncStatus.state}`} style={{ marginLeft: 6 }} title={statusText(syncStatus)} />}
            </button>
          </div>
        </div>
      </header>

      {update && (
        <div className="banner accent" role="status">
          <span className="grow"><strong>An update is ready.</strong> Reload to use the new version.</span>
          <button type="button" className="btn solid" onClick={() => update.waiting?.postMessage("skip-waiting")}>Reload</button>
        </div>
      )}
      {shared && (
        <div className="banner accent" role="status">
          <span className="grow">
            <strong>Shared patch: {shared.patch.name}</strong> · {Object.keys(shared.patch.jacks).length} connections
          </span>
          <button
            type="button"
            className="btn solid"
            onClick={async () => {
              await actions.importShared(shared);
              setShared(null);
              setSel({ kind: "none" });
              toast("Shared patch added to your patchbook");
            }}
          >
            Add to my patchbook
          </button>
          <button type="button" className="btn" onClick={() => setShared(null)}>Dismiss</button>
        </div>
      )}
      {syncInvite && <SyncInvite syncKey={syncInvite} onDone={() => setSyncInvite(null)} onError={setShareError} />}
      {syncStatus.state === "error" && (
        <div className="banner warn" role="alert">
          <span className="grow">{statusText(syncStatus)}</span>
          <button type="button" className="btn" onClick={() => void sync.syncNow()}>Try again</button>
        </div>
      )}
      {shareError && (
        <div className="banner warn" role="alert">
          <span className="grow">{shareError}</span>
          <button type="button" className="btn" onClick={() => setShareError("")}>Dismiss</button>
        </div>
      )}

      <div className={`bench ${vp}`}>
        {!p && sel.kind === "none" ? (
          <div className="stage" style={{ gridColumn: "1 / -1" }}>
            <Welcome onStart={() => actions.createPatch("My first patch")} onRacks={() => showRacks()} onImport={() => setSel({ kind: "data" })} onDemo={loadDemo} />
            {racksView}
          </div>
        ) : (
        <div className="stage">
          <div className="viewtabs" role="group" aria-label="Show">
            <button type="button" className="chip toggle" aria-pressed={show.panel} onClick={() => setShow((v) => ({ ...v, panel: !v.panel }))}>
              {vp === "narrow" ? "Jacks" : "Panel"}
            </button>
            <button type="button" className="chip toggle" aria-pressed={show.sheet} onClick={() => setShow((v) => ({ ...v, sheet: !v.sheet }))}>
              Connection sheet{p ? ` · ${Object.values(countZones(p)).reduce((a, b) => a + b, 0)}` : ""}
            </button>
            <button type="button" className="chip toggle" aria-pressed={show.racks} onClick={() => (show.racks ? setShow((v) => ({ ...v, racks: false })) : showRacks())}>
              My racks{state.racks.length ? ` · ${state.racks.length}` : ""}
            </button>
            {vp !== "narrow" && p && show.panel && <span className="hint draghint">Tip: drag from a jack onto a module to patch it{matchMedia("(pointer: coarse)").matches ? " (press and hold first)" : ""}.</span>}
          </div>
          {show.panel &&
            (vp === "narrow" ? (
              <ChannelStrip
                patch={p}
                library={state.library}
                selection={sel}
                zoneFilter={zoneFilter}
                moduleFilter={moduleFilter}
                onJack={(id) => p && setSel({ kind: "jack", id })}
                onTrack={(n) => p && setSel({ kind: "track", n })}
                onSettings={() => setSel({ kind: "none" })}
              />
            ) : (
              <Faceplate
                patch={p}
                library={state.library}
                selection={sel}
                zoneFilter={zoneFilter}
                moduleFilter={moduleFilter}
                onJack={(id) => p && setSel({ kind: "jack", id })}
                onTrack={(n) => p && setSel({ kind: "track", n })}
                onSettings={() => setSel({ kind: "none" })}
              />
            ))}
          {show.sheet && (
            <ConnectionSheet
              patch={p}
              library={state.library}
              zoneFilter={zoneFilter}
              moduleFilter={moduleFilter}
              setZoneFilter={setZoneFilter}
              setModuleFilter={setModuleFilter}
              onJack={(id) => setSel({ kind: "jack", id })}
            />
          )}
          {racksView}
          {!show.panel && !show.sheet && !show.racks && <p className="hint">Turn on the panel, the connection sheet or your racks above.</p>}
        </div>
)}
        {(p || sel.kind !== "none") && (
        <aside className={`editor${asSheet ? " as-sheet" : ""}`} aria-live="polite" ref={sheetRef}>
          {asSheet && <span className="grabber" aria-hidden="true" />}
          {side()}
        </aside>
        )}
      </div>

      <footer className="foot-note">
        <span>
          Unofficial. Patchbook for Reliq is a community project and isn't affiliated with or endorsed by Reliq Instruments.{" "}
          <button type="button" className="linkbtn" onClick={() => setSel({ kind: "privacy" })}>Privacy</button> ·{" "}
          <a className="linkbtn" href={ISSUES_URL} target="_blank" rel="noreferrer">Help and feedback</a>
        </span>
        <span>
          {sync.enabled
            ? "Your patches sync between your devices. Keep a backup too, from Backup & sync."
            : `Your patches stay in this browser. Back them up from ${syncAvailable ? "Backup & sync" : "Backup & share"}.`}
        </span>
      </footer>
    </div>
    </CableDragProvider>
  );
}

/** wide: panel and editor side by side. mid: stacked, editor as a bottom sheet. narrow: phone layout. */
function useViewport(): "wide" | "mid" | "narrow" {
  const get = (): "wide" | "mid" | "narrow" => (matchMedia("(min-width: 1000px)").matches ? "wide" : matchMedia("(min-width: 700px)").matches ? "mid" : "narrow");
  const [vp, setVp] = useState(get);
  useEffect(() => {
    const qs = [matchMedia("(min-width: 1000px)"), matchMedia("(min-width: 700px)")];
    const h = () => setVp(get());
    qs.forEach((q) => q.addEventListener("change", h));
    return () => qs.forEach((q) => q.removeEventListener("change", h));
  }, []);
  return vp;
}

function Welcome({ onStart, onRacks, onImport, onDemo }: { onStart: () => void; onRacks: () => void; onImport: () => void; onDemo: () => void }) {
  const status = useSyncStatus();
  const joining = syncAvailable && status.state !== "off" && status.state !== "unavailable";
  return (
    <div className="empty-app">
      <h2>Welcome</h2>
      {joining ? (
        <p className="hint" style={{ fontSize: 14 }}>
          This device is syncing. {statusText(status)} Your patches appear here as soon as they arrive.
        </p>
      ) : (
        <>
          <p className="hint" style={{ fontSize: 14 }}>
            Patchbook keeps track of what's plugged into your Reliq Breakout Module. Start a patch, then tap any jack on the panel.
          </p>
          {syncAvailable && (
            <div className="welcome-join">
              <strong>Already using Patchbook on another device?</strong>
              <JoinForm />
            </div>
          )}
        </>
      )}
      <div className="row">
        <button type="button" className="btn solid" onClick={onStart}>Start a patch</button>
        <button type="button" className="btn" onClick={onRacks}>Set up my racks</button>
        <button type="button" className="btn" onClick={onImport}>Import a backup</button>
      </div>
      <p className="hint">
        Just looking? <button type="button" className="linkbtn" onClick={onDemo}>Try the demo patch</button>: drums, Plaits, Rings and Beads on
        real modules, with a demo rack. Delete it any time.
      </p>
    </div>
  );
}

/** Which views are showing. Remembered on this device only. */
function useShowPrefs() {
  const KEY = "patchbook:show";
  const [show, setShow] = useState<{ panel: boolean; sheet: boolean; racks: boolean }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "");
      if (typeof v?.panel === "boolean" && typeof v?.sheet === "boolean") return { panel: v.panel, sheet: v.sheet, racks: v.racks === true };
    } catch { /* first visit, or storage unavailable */ }
    return { panel: true, sheet: false, racks: false };
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(show));
    } catch { /* ignore */ }
  }, [show]);
  return [show, setShow] as const;
}

/**
 * Shown when the app is opened with a sync link. Joining hands this device's patches to whoever
 * made the link, so it says so plainly, and switching away from an existing sync space takes a
 * second, explicit tap.
 */
function SyncInvite({ syncKey, onDone, onError }: { syncKey: string; onDone: () => void; onError: (m: string) => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const switching = sync.enabled;
  const join = async () => {
    try {
      await sync.join(syncKey);
      toast("Joined. Your patches from other devices are on their way. You can undo this from Backup & sync.");
    } catch (e) {
      onError(e instanceof SyncError ? e.message : "Couldn't join sync.");
    }
    onDone();
  };
  return (
    <div className="banner accent" role="alertdialog" aria-label="Join a sync space">
      <span className="grow">
        <strong>{switching ? "Switch this device to a different sync space?" : "Sync this device?"}</strong> Only continue if you made this
        link yourself, on one of your own devices. Whoever made it can see, change and delete everything on this device once it joins. To
        share a patch with someone, use a share link instead.
        {switching && " This device already syncs with a different key; joining moves it over."} Patchbook keeps a copy of what's here now,
        so you can undo it from Backup &amp; sync.
      </span>
      {switching && !confirming ? (
        <button type="button" className="btn solid" onClick={() => setConfirming(true)}>Switch sync space…</button>
      ) : (
        <button type="button" className="btn solid" onClick={join}>{switching ? "Yes, switch this device" : "Sync this device"}</button>
      )}
      <button type="button" className="btn" onClick={onDone} title={formatKey(syncKey)}>Not now</button>
    </div>
  );
}
