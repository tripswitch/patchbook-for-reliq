import { useEffect, useMemo, useRef, useState } from "react";
import type { JackId, Patch, Rack } from "../lib/types";
import { DIR_TEXT, JACKS, ZONE_NAME, trackOf } from "../lib/panel";
import { derivedRole, trackLabel } from "../lib/patch";
import { jackList, listKey, moduleGroups, type Library } from "../lib/library";
import { jackUse, nextJack, prevJack, rankJacks, searchModules, suggestedModules } from "../lib/flow";
import type { Actions } from "../state";
import { CableStep, ConfirmButton, useToast } from "./ui";
import { SIGNAL_LABEL, signalOf } from "../lib/signals";
import type { Signal } from "../lib/types";

interface Props {
  patch: Patch;
  jackId: JackId;
  library: Library;
  racks: Rack[];
  actions: Actions;
  /** The jack "Next" or "Previous" came from, so its module can be offered first. */
  cameFrom?: JackId | null;
  /** Set after a cable was dropped on a module: go straight to picking the jack. */
  dropped?: boolean;
  /** Custom cable colours used in your patches. */
  customColours?: string[];
  onDone: () => void;
  onGo: (id: JackId, from: JackId) => void;
  onTrack: (n: number) => void;
  onEditModule: (id: string) => void;
}

const ROLE_PLACEHOLDER = {
  audio: { in: "feeds Reliq track 3 / resampler", out: "Reliq drum bus, track 5 out" },
  cv: { in: "", out: "Track 2 pitch, LFO 1" },
  gate: { in: "", out: "Track 1 kick trigger" },
  sync: { in: "", out: "24 PPQN to sequencer" },
};

/**
 * Patch a jack in three taps: module, its jack, cable colour. "Next" walks on to the next
 * jack in voice order (A n → B n → Gate n), offering the module you just used first.
 */
export function JackEditor({ patch, jackId, library, racks, actions, cameFrom, dropped, customColours = [], onDone, onGo, onTrack, onEditModule }: Props) {
  const toast = useToast();
  const j = JACKS[jackId];
  const d = patch.jacks[jackId] ?? {};
  const tn = trackOf(jackId);
  const derived = derivedRole(patch, jackId);
  const mod = d.mod ? library.get(d.mod) : undefined;
  const list = jackList(library, d.mod, j.dir);
  const kind = j.dir === "in" ? "output" : "input";
  const next = nextJack(jackId);
  const prev = prevJack(jackId);

  const [picking, setPicking] = useState(!d.mod);
  const [query, setQuery] = useState("");
  const [other, setOther] = useState(!!(list && d.to && !list.includes(d.to)));
  const [freeText, setFreeText] = useState(false);
  const jackStep = useRef<HTMLElement>(null);

  const suggested = useMemo(() => suggestedModules(patch, jackId, library, cameFrom), [patch, jackId, library, cameFrom]);
  const groups = useMemo(() => moduleGroups(library, racks).filter((g) => !racks.length || racks.some((r) => r.name === g.label)), [library, racks]);
  const [rack, setRack] = useState(() => {
    const want = d.mod ?? suggested[0];
    return groups.find((g) => g.modules.some((m) => m.id === want))?.label ?? groups[0]?.label ?? "";
  });
  const results = useMemo(() => searchModules(library, query), [library, query]);
  const used = useMemo(() => (d.mod ? jackUse(patch, d.mod, jackId) : new Map<string, string>()), [patch, d.mod, jackId]);
  const ranked = list ? rankJacks(jackId, list) : [];

  useEffect(() => {
    if (dropped) jackStep.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [dropped]);

  // A module set from outside (a cable dropped on it, or another device) moves on to step 2.
  const prevMod = useRef(d.mod);
  useEffect(() => {
    if (d.mod && d.mod !== prevMod.current) setPicking(false);
    prevMod.current = d.mod;
  }, [d.mod]);

  // Bring the chosen rack's tab into view in its scrolling row.
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = tabs.current, tab = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && tab) row.scrollLeft = tab.offsetLeft - row.offsetLeft - 8;
  }, [picking, rack]);

  const set = (field: "role" | "to" | "note" | "color" | "led", v: string) => actions.setJackField(patch.id, jackId, field, v);

  const chooseModule = (id: string) => {
    actions.setJackModule(patch.id, jackId, id);
    setPicking(false);
    setQuery("");
    setOther(false);
    setFreeText(false);
    requestAnimationFrame(() => jackStep.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const learn = async (value: string) => {
    const v = value.trim();
    if (!v || !d.mod || !library.has(d.mod)) return;
    if (await actions.learnJack(d.mod, listKey(j.dir), v)) toast(`Added “${v}” to ${library.get(d.mod)!.name}'s ${kind}s`);
  };

  const modChip = (id: string) => {
    const m = library.get(id);
    if (!m) return null;
    return (
      <button key={id} type="button" className="pchip" data-mod={id} data-drop-mod={id} aria-pressed={d.mod === id} onClick={() => chooseModule(id)}>
        {m.name}
      </button>
    );
  };

  const zoneColour = `var(--${j.zone === "sync" ? "silk-dim" : j.zone})`;
  const hasExtras = !!(d.role || d.note);

  return (
    <div className="stack flow" data-jack-editor={jackId}>
      <div className="ed-head">
        <div>
          <div className="sect" style={{ color: zoneColour }}>{ZONE_NAME[j.zone]} · {DIR_TEXT[j.dir].toLowerCase()}</div>
          <h3>{j.label}</h3>
        </div>
        <button type="button" className="btn small" onClick={onDone} aria-label="Close">Done</button>
      </div>
      {tn && (
        <button type="button" className="trklink" onClick={() => onTrack(tn)}>
          {patch.tracks[tn] ? trackLabel(patch, tn) + (patch.tracks[tn].custom ? " (custom routing)" : "") : `Part of Track ${tn}: name the track`} ›
        </button>
      )}

      {/* 1 · module */}
      <section className="step" aria-labelledby="s1">
        <div className="step-h" id="s1">
          <span className="num">1</span>
          {j.dir === "in" ? "From module" : "To module"}
          {!picking && (
            <button type="button" className="linkbtn" onClick={() => setPicking(true)}>Change</button>
          )}
        </div>
        {!picking ? (
          <div className="chiprow">
            {mod ? (
              <span className="pchip chosen" data-drop-mod={mod.id}>{mod.name}</span>
            ) : d.mod ? (
              <span className="pchip chosen">{d.mod} (not in library)</span>
            ) : (
              <span className="hint">Not a module in the library</span>
            )}
          </div>
        ) : (
          <>
            <input
              type="search"
              id="fModSearch"
              className="search"
              placeholder="Search all modules"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              onKeyDown={(e) => e.key === "Enter" && results[0] && chooseModule(results[0])}
            />
            {query ? (
              <div className="chiprow">
                {results.length ? results.map(modChip) : <span className="hint">No module called that. Add it from My racks → Add a module.</span>}
              </div>
            ) : (
              <>
                {suggested.length > 0 && (
                  <div className="chipgroup">
                    <span className="fl">{cameFrom && patch.jacks[cameFrom]?.mod === suggested[0] ? `Same as ${JACKS[cameFrom].label}, or in this patch` : "In this patch"}</span>
                    <div className="chiprow">{suggested.map(modChip)}</div>
                  </div>
                )}
                {groups.length > 1 && (
                  <div className="chiprow racktabs" role="group" aria-label="Rack" ref={tabs}>
                    {groups.map((g) => (
                      <button key={g.label} type="button" className="rchip" aria-pressed={rack === g.label} onClick={() => setRack(g.label)}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="chiprow">{groups.find((g) => g.label === rack)?.modules.map((m) => modChip(m.id))}</div>
              </>
            )}
            <div className="row">
              {d.mod && <button type="button" className="linkbtn" onClick={() => setPicking(false)}>Keep {mod?.name ?? d.mod}</button>}
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  if (d.mod) actions.setJackModule(patch.id, jackId, "");
                  setPicking(false);
                  setFreeText(true);
                }}
              >
                It's not a module in the library
              </button>
            </div>
          </>
        )}
      </section>

      {/* 2 · jack */}
      {(!picking || d.to) && (
        <section className={`step${dropped ? " pulse" : ""}`} aria-labelledby="s2" ref={jackStep}>
          <div className="step-h" id="s2">
            <span className="num">2</span>
            {mod ? `${mod.name} ${kind}` : `${kind[0].toUpperCase()}${kind.slice(1)} jack`}
          </div>
          {list ? (
            <>
              <div className="chiprow" role="group" aria-label={`${mod?.name ?? "Module"} ${kind}s`}>
                {ranked.map(({ name, suggested: s }) => {
                  const where = used.get(name);
                  const sig = signalOf(mod, name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`pchip jchip sig-${sig}${s ? " sug" : ""}${where ? " used" : ""}`}
                      data-signal={sig}
                      data-jackname={name}
                      data-drop-mod={d.mod}
                      data-drop-to={name}
                      data-drop-dir={j.dir}
                      aria-pressed={!other && d.to === name}
                      title={`${SIGNAL_LABEL[sig]}${where ? ` · also patched from ${where}` : s ? " · likely match" : ""}`}
                      onClick={() => (setOther(false), set("to", d.to === name ? "" : name))}
                    >
                      {name}
                      {where && <small> · {where}</small>}
                    </button>
                  );
                })}
                <button type="button" className="pchip" aria-pressed={other} onClick={() => (setOther(true), set("to", ""))}>
                  Other…
                </button>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <SignalKey present={ranked.map((x) => signalOf(mod, x.name))} />
                {mod && (
                  <button type="button" className="linkbtn" onClick={() => onEditModule(mod.id)}>
                    Change jack types
                  </button>
                )}
              </div>
              {other && (
                <input
                  type="text"
                  id="fTo"
                  autoFocus
                  maxLength={24}
                  placeholder="Type the jack name"
                  value={d.to ?? ""}
                  onChange={(e) => set("to", e.target.value)}
                  onBlur={(e) => learn(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                />
              )}
              {mod?.confidence !== "high" && <span className="hint warnhint">This jack list isn't confirmed against the panel yet.</span>}
            </>
          ) : (
            <>
              <input
                type="text"
                id="fTo"
                autoFocus={freeText}
                maxLength={120}
                placeholder={mod ? (j.dir === "in" ? "OUT L" : "V/OCT") : "Mixer channel 3, outboard reverb…"}
                value={d.to ?? ""}
                onChange={(e) => set("to", e.target.value)}
                onBlur={(e) => learn(e.target.value)}
              />
              <span className="hint">
                {mod ? `No ${kind} list for ${mod.name} yet. What you type is added to it.` : "Describe what's at the other end of the cable."}
              </span>
            </>
          )}
        </section>
      )}

      {/* 3 · cable */}
      {(!picking || d.color || d.led) && (
        <section className="step" aria-labelledby="s3">
          <div className="step-h" id="s3"><span className="num">3</span>Cable</div>
          <CableStep value={d.color} led={d.led} customs={customColours} onColour={(c) => set("color", c)} onLed={(l) => set("led", l)} />
        </section>
      )}

      <details className="more" open={hasExtras || undefined}>
        <summary>Reliq side and notes</summary>
        <div className="stack" style={{ paddingTop: 10 }}>
          <div className="field">
            <label htmlFor="fRole">Reliq side</label>
            <input
              type="text"
              id="fRole"
              maxLength={120}
              value={d.role ?? ""}
              placeholder={derived || ROLE_PLACEHOLDER[j.zone][j.dir]}
              onChange={(e) => set("role", e.target.value)}
            />
            <span className="hint">
              {derived ? "Leave blank to use the track label shown." : j.dir === "in" ? "Where this audio lands inside the Reliq." : "What the Reliq is sending out of this jack."}
            </span>
          </div>
          <div className="field">
            <label htmlFor="fNote">Notes</label>
            <textarea id="fNote" maxLength={1000} placeholder="Attenuation, range, Reliq settings, why it's there…" value={d.note ?? ""} onChange={(e) => set("note", e.target.value)} />
          </div>
          {mod && (
            <button type="button" className="linkbtn" onClick={() => onEditModule(mod.id)}>Edit {mod.name}'s jack list</button>
          )}
        </div>
      </details>

      {(d.mod || d.to || d.color || d.led || d.role || d.note) && (
        <div className="row unpatch">
          <ConfirmButton
            label="Unpatch jack"
            question="Clear this jack?"
            confirmLabel="Clear"
            onConfirm={() => (actions.clearJack(patch.id, jackId), setPicking(true), toast("Jack cleared"))}
          />
        </div>
      )}

      <div className="ed-actions walk">
        <button type="button" className="btn" disabled={!prev} onClick={() => prev && onGo(prev, jackId)} title="Previous jack ([)">
          ‹ {prev ? JACKS[prev].label : ""}
        </button>
        <button type="button" className="btn solid" disabled={!next} onClick={() => next && onGo(next, jackId)} title="Next jack (])">
          Next: {next ? JACKS[next].label : "—"} ›
        </button>
      </div>
    </div>
  );
}

/** A small key for the jack colours, listing only the types this module has. */
function SignalKey({ present }: { present: Signal[] }) {
  const types = (Object.keys(SIGNAL_LABEL) as Signal[]).filter((t) => present.includes(t));
  if (types.length < 2) return null;
  return (
    <div className="sigkey" aria-hidden="true">
      {types.map((t) => (
        <span key={t} className={`sig-${t}`}>
          <i />
          {SIGNAL_LABEL[t]}
        </span>
      ))}
    </div>
  );
}
