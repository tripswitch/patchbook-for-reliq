import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { Library } from "../lib/library";
import { moduleGroups } from "../lib/library";
import type { CableColor, Rack } from "../lib/types";
import { CABLES, LED_COLOURS, cableHex, isHexColour } from "../lib/panel";

/* ---------- toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const [on, setOn] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    setOn(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setOn(false), 1800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={`toast${on ? " on" : ""}`} role="status" aria-live="polite">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- a destructive button that asks first, inline ---------- */
export function ConfirmButton({
  label, question, confirmLabel, onConfirm, disabled,
}: { label: string; question: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" className="btn danger" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <span className="confirm">
      {question}
      <button type="button" className="btn danger" onClick={() => (setAsking(false), onConfirm())}>
        {confirmLabel}
      </button>
      <button type="button" className="btn" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}

/* ---------- module picker: racks first, then the rest of the library ---------- */
export function ModuleSelect({
  id, value, onChange, library, racks, emptyLabel = "Not in my racks / none",
}: { id: string; value?: string; onChange: (v: string) => void; library: Library; racks: Rack[]; emptyLabel?: string }) {
  const groups = moduleGroups(library, racks);
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {value && !library.has(value) && <option value={value}>{value} (not in library)</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/* ---------- cable colour swatches ---------- */
export function CableSwatches({ value, onChange, bare }: { value?: CableColor; onChange: (c: CableColor | "") => void; bare?: boolean }) {
  return (
    <div className="field">
      {!bare && <span className="fl" id="cabLbl">Cable</span>}
      <div className="swatches" role="group" aria-labelledby={bare ? "s3" : "cabLbl"}>
        <button type="button" className="sw none" aria-label="No cable colour" aria-pressed={!value} onClick={() => onChange("")} />
        {CABLES.map(([name, hex]) => (
          <button
            key={name}
            type="button"
            className="sw"
            style={{ ["--c" as string]: hex }}
            aria-label={name}
            title={name}
            aria-pressed={value === name}
            onClick={() => onChange(name)}
          />
        ))}
      </div>
    </div>
  );
}

/** Copy text, falling back to selecting it in a textarea when the clipboard is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadFile(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- cable step: colour (standard, yours, custom picker) and LED plugs ---------- */
export function CableStep({
  value, led, customs, onColour, onLed,
}: {
  value?: string;
  led?: string;
  /** Custom colours already used in your patches. */
  customs: string[];
  onColour: (c: string) => void;
  onLed: (l: string) => void;
}) {
  const yours = [...new Set([...(value && isHexColour(value) ? [value.toLowerCase()] : []), ...customs])];
  const lastLed = useRef<string>("bi");
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="swatches" role="group" aria-label="Cable colour">
        <button type="button" className="sw none" aria-label="No cable colour" aria-pressed={!value} onClick={() => onColour("")} />
        {CABLES.map(([name, hex]) => (
          <button key={name} type="button" className="sw" style={{ ["--c" as string]: hex }} aria-label={name} title={name}
            aria-pressed={value === name} onClick={() => onColour(name)} />
        ))}
        {yours.length > 0 && <span className="swsep" aria-hidden="true" />}
        {yours.map((hex) => (
          <button key={hex} type="button" className="sw" style={{ ["--c" as string]: hex }} aria-label={`Custom colour ${hex}`} title={hex}
            aria-pressed={value?.toLowerCase() === hex} onClick={() => onColour(hex)} />
        ))}
        <label className="sw pick" title="Pick a custom colour">
          <span className="sr-only">Pick a custom colour</span>
          <input type="color" value={cableHex(value) ?? "#808080"} onChange={(e) => onColour(e.target.value.toLowerCase())} />
          <span aria-hidden="true">+</span>
        </label>
      </div>
      <div className="row ledrow">
        <button
          type="button"
          className="pchip"
          aria-pressed={!!led}
          onClick={() => {
            if (led) {
              lastLed.current = led;
              onLed("");
            } else onLed(lastLed.current);
          }}
        >
          LED plugs
        </button>
        {led && (
          <div className="swatches" role="group" aria-label="LED colour">
            <button type="button" className="sw ledsw bi" aria-label="Bi-colour LED (polarity)" title="Bi-colour (polarity)" aria-pressed={led === "bi"} onClick={() => onLed("bi")} />
            {LED_COLOURS.map(([name, hex]) => (
              <button key={name} type="button" className="sw ledsw" style={{ ["--c" as string]: hex }} aria-label={`${name} LED`} title={`${name} LED`}
                aria-pressed={led === name} onClick={() => onLed(name)} />
            ))}
            <label className="sw ledsw pick" title="Pick an LED colour">
              <span className="sr-only">Pick an LED colour</span>
              <input type="color" value={isHexColour(led) ? led : "#4fd16b"} onChange={(e) => onLed(e.target.value.toLowerCase())} />
              <span aria-hidden="true">+</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
