import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JackId, Patch, Rack } from "../lib/types";
import { JACKS, cableHex, ledHex } from "../lib/panel";
import { moduleGroups, type Library } from "../lib/library";
import { suggestedModules } from "../lib/flow";

/**
 * Drag a cable out of a jack and drop it on a module.
 *
 * Mouse and pen: press on a jack and move. Touch: press and hold for a moment, then drag
 * (so ordinary swipes still scroll the page). While dragging, a tray of your rack's modules
 * appears on the side of the screen away from the jack, and a cable follows your finger.
 * Dropping on a module patches the jack to it and opens the jack so you can pick which input.
 * Tapping a jack without dragging works as before.
 */

interface Bind {
  onPointerDown: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
}
interface Ctx {
  enabled: boolean;
  dragging: JackId | null;
  bind: (id: JackId) => Bind | Record<string, never>;
}
const CableCtx = createContext<Ctx>({ enabled: false, dragging: null, bind: () => ({}) });
export const useCableDrag = () => useContext(CableCtx);

const HOLD_MS = 280;
const MOVE_SLOP = 8;

interface Drag {
  id: JackId;
  x0: number;
  y0: number;
  x: number;
  y: number;
  over: string | null;
  /** Set when hovering one of a module's jacks in the open jack editor. */
  to: string | null;
  trayTop: boolean;
}

let overEl: HTMLElement | null = null;
function markOver(el: HTMLElement | null) {
  if (overEl === el) return;
  overEl?.classList.remove("drop-over");
  el?.classList.add("drop-over");
  overEl = el;
}

/** Centre of a jack's nut, measured now (so scrolling or scaling can't leave the cable behind). */
function jackCentre(id: JackId): { x: number; y: number } | null {
  const r = document.querySelector<HTMLElement>(`[data-jack="${id}"] .nut`)?.getBoundingClientRect();
  return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

export function CableDragProvider({
  children, enabled, patch, library, racks, onDrop,
}: {
  children: ReactNode;
  enabled: boolean;
  patch: Patch | null;
  library: Library;
  racks: Rack[];
  onDrop: (jack: JackId, mod: string, to?: string) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef<{ id: JackId; x: number; y: number; touch: boolean; timer?: ReturnType<typeof setTimeout>; pointerId: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const begin = useCallback((id: JackId, x: number, y: number) => {
    const c = jackCentre(id) ?? { x, y };
    update({ id, x0: c.x, y0: c.y, x, y, over: null, to: null, trayTop: c.y > window.innerHeight * 0.5 });
    document.documentElement.classList.add("cable-dragging");
    navigator.vibrate?.(8);
  }, []);

  const end = useCallback((drop: boolean) => {
    const d = dragRef.current;
    if (pending.current?.timer) clearTimeout(pending.current.timer);
    pending.current = null;
    if (!d) return;
    update(null);
    markOver(null);
    document.documentElement.classList.remove("cable-dragging");
    suppressClickUntil.current = Date.now() + 400;
    if (drop && d.over) onDropRef.current(d.id, d.over, d.to ?? undefined);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (p && p.pointerId === e.pointerId && !dragRef.current) {
        const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP;
        if (!far) return;
        if (p.touch) {
          // Moved before the hold finished: the user is scrolling.
          clearTimeout(p.timer);
          pending.current = null;
        } else {
          begin(p.id, e.clientX, e.clientY);
        }
      }
      const d = dragRef.current;
      if (!d) return;
      // Drop targets: tiles in the tray, and the module and jack chips in the open jack editor.
      let hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-mod]") ?? null;
      // A jack chip lists jacks for the editor's jack; only accept it for a cable going the same way.
      if (hit?.dataset.dropDir && hit.dataset.dropDir !== JACKS[d.id].dir) hit = null;
      markOver(hit);
      update({ ...d, x: e.clientX, y: e.clientY, over: hit?.dataset.dropMod ?? null, to: hit?.dataset.dropTo ?? null });
    };
    const up = (e: PointerEvent) => {
      if (pending.current && pending.current.pointerId === e.pointerId && !dragRef.current) {
        clearTimeout(pending.current.timer);
        pending.current = null;
        return;
      }
      if (dragRef.current) end(true);
    };
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && dragRef.current && end(false);
    // Stop the page scrolling under a finger that's dragging a cable.
    const touchmove = (e: TouchEvent) => dragRef.current && e.cancelable && e.preventDefault();
    const menu = (e: Event) => (dragRef.current || pending.current?.touch) && e.preventDefault();
    // Redraw if anything scrolls mid-drag, so the cable stays on its jack.
    const scrolled = () => dragRef.current && update({ ...dragRef.current });
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    document.addEventListener("touchmove", touchmove, { passive: false });
    document.addEventListener("contextmenu", menu);
    return () => {
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("touchmove", touchmove);
      document.removeEventListener("contextmenu", menu);
    };
  }, [enabled, begin, end]);

  const bind = useCallback(
    (id: JackId): Bind | Record<string, never> => {
      if (!enabled) return {};
      return {
        onPointerDown(e) {
          if (e.button !== 0 || !patch) return;
          const touch = e.pointerType === "touch";
          const p = { id, x: e.clientX, y: e.clientY, touch, pointerId: e.pointerId } as NonNullable<typeof pending.current>;
          if (touch) p.timer = setTimeout(() => pending.current === p && begin(id, p.x, p.y), HOLD_MS);
          pending.current = p;
        },
        onClickCapture(e) {
          if (Date.now() < suppressClickUntil.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
      };
    },
    [enabled, patch, begin],
  );

  const value = useMemo<Ctx>(() => ({ enabled, dragging: drag?.id ?? null, bind }), [enabled, drag?.id, bind]);

  return (
    <CableCtx.Provider value={value}>
      {children}
      {drag && patch && <DragLayer drag={drag} patch={patch} library={library} racks={racks} />}
    </CableCtx.Provider>
  );
}

function DragLayer({ drag, patch, library, racks }: { drag: Drag; patch: Patch; library: Library; racks: Rack[] }) {
  const j = JACKS[drag.id];
  const d = patch.jacks[drag.id];
  const colour = cableHex(d?.color) ?? `var(--${j.zone === "sync" ? "silk-dim" : j.zone})`;
  const led = d?.led ? ledHex(d.led) ?? "#4fd16b" : null;
  const live = jackCentre(drag.id);
  const x0 = live?.x ?? drag.x0, y0 = live?.y ?? drag.y0;
  const { x, y } = drag;
  const dist = Math.hypot(x - x0, y - y0);
  const sag = Math.min(140, dist * 0.35);
  const path = `M ${x0} ${y0} Q ${(x0 + x) / 2} ${(y0 + y) / 2 + sag} ${x} ${y}`;

  const suggested = suggestedModules(patch, drag.id, library);
  // Your racks only (or the whole library if you haven't set any up).
  const groups = moduleGroups(library, racks).filter((g) => !racks.length || racks.some((r) => r.name === g.label));
  const overName = drag.over ? `${library.get(drag.over)?.name ?? drag.over}${drag.to ? ` › ${drag.to}` : ""}` : null;

  const tile = (id: string, name: string) => (
    <div key={id} className={`droptile${drag.over === id ? " over" : ""}${d?.mod === id ? " current" : ""}`} data-drop-mod={id}>
      {name}
    </div>
  );

  return (
    <>
      <div className={`droptray${drag.trayTop ? " top" : ""}`} role="region" aria-label="Drop the cable on a module">
        <div className="droptray-head">
          <b>{j.label}</b> → {overName ? <b>{overName}</b> : "drop on a module"}
          <span className="hint"> · Esc or drop elsewhere to cancel</span>
        </div>
        <div className="droptray-body">
          {suggested.length > 0 && (
            <div className="dropgroup">
              <span className="droplabel">In this patch</span>
              {suggested.map((id) => tile(id, library.get(id)!.name))}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.label} className="dropgroup">
              <span className="droplabel">{g.label}</span>
              {g.modules.map((m) => tile(m.id, library.get(m.id)!.name))}
            </div>
          ))}
        </div>
      </div>
      <svg className="cablelayer" aria-hidden="true">
        <path d={path} stroke="#000" strokeOpacity=".35" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d={path} stroke={colour} strokeWidth="6" fill="none" strokeLinecap="round" />
        {led && <circle cx={x0} cy={y0} r="12" fill="none" stroke={led} strokeWidth="2.5" opacity=".9" />}
        {led && <circle cx={x} cy={y} r={drag.over ? 16 : 14} fill="none" stroke={d?.led === "bi" ? "#ff4a4a" : led} strokeWidth="2.5" opacity=".9" />}
        <circle cx={x0} cy={y0} r="8" fill={colour} stroke="#000" strokeOpacity=".4" strokeWidth="2" />
        <circle cx={x} cy={y} r={drag.over ? 12 : 10} fill={colour} stroke="#000" strokeOpacity=".45" strokeWidth="2.5" />
      </svg>
    </>
  );
}
