import type { CableColor, Direction, JackDef, JackId, Zone } from "./types";

/**
 * The Reliq Breakout Module front panel: 16 columns.
 * Matrix: IN 1–16 over OUT 1–16. CV: A/B per channel. Gates: 1–16. Clock and Reset outs.
 * Source: Reliq manual v1.10.0, Breakout Module specs (p25) and panel layout.
 */
export const N16 = Array.from({ length: 16 }, (_, i) => i + 1);

export const JACKS: Record<JackId, JackDef> = {};
/** Order the connection sheet lists jacks in. */
export const ORDER: JackId[] = [];

function def(id: JackId, label: string, name: string, dir: Direction, zone: Zone): JackDef {
  const j: JackDef = { id, label, name, dir, zone };
  JACKS[id] = j;
  ORDER.push(id);
  return j;
}

export const MATRIX_IN = N16.map((n) => def(`mi${n}`, `IN ${n}`, `Matrix In ${n}`, "in", "audio"));
export const MATRIX_OUT = N16.map((n) => def(`mo${n}`, `OUT ${n}`, `Matrix Out ${n}`, "out", "audio"));
export const CV_A: JackDef[] = [];
export const CV_B: JackDef[] = [];
for (const n of N16) {
  CV_A.push(def(`cv${n}a`, `A ${n}`, `CV A${n}`, "out", "cv"));
  CV_B.push(def(`cv${n}b`, `B ${n}`, `CV B${n}`, "out", "cv"));
}
export const GATES = N16.map((n) => def(`g${n}`, `GATE ${n}`, `Gate ${n}`, "out", "gate"));
export const CLOCK = def("clk", "CLK OUT", "Clock Out", "out", "sync");
export const RESET = def("rst", "RST OUT", "Reset Out", "out", "sync");

export const ZONE_NAME: Record<Zone, string> = { audio: "Matrix", cv: "CV", gate: "Gate", sync: "Clock / Reset" };
export const ZONE_TOTAL: Record<Zone, number> = { audio: 32, cv: 32, gate: 16, sync: 2 };
export const DIR_TEXT: Record<Direction, string> = { in: "Into Reliq", out: "Out of Reliq" };

export const CABLES: [CableColor, string][] = [
  ["red", "#d64545"], ["orange", "#e8833a"], ["yellow", "#e8c547"], ["green", "#4caf6a"], ["blue", "#3f7fd9"],
  ["purple", "#8a5cd0"], ["pink", "#e26fa8"], ["white", "#f1f1ee"], ["grey", "#8b8f96"], ["black", "#1e1f22"],
];
export const CABLE_HEX = Object.fromEntries(CABLES) as Record<CableColor, string>;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColour = (c: unknown): c is `#${string}` => typeof c === "string" && HEX.test(c);
export const isCableColour = (c: unknown): c is CableColor => typeof c === "string" && Object.hasOwn(CABLE_HEX, c);

/** The colour to draw for a cable or LED value (standard name or #rrggbb). */
export function cableHex(c?: string): string | undefined {
  if (!c) return undefined;
  return isCableColour(c) ? CABLE_HEX[c] : isHexColour(c) ? c : undefined;
}
/** How a cable colour reads in text: the standard name, or "custom #2bb5a5". */
export const cableName = (c?: string) => (!c ? "" : isCableColour(c) ? c : isHexColour(c) ? `custom ${c.toLowerCase()}` : "");

/** Dark enough to need a light outline on the dark panel. */
export function isDark(hex?: string): boolean {
  if (!hex || !HEX.test(hex)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
}

/** LED glow colours offered for LED cables, plus "bi" (two-colour polarity LED). */
export const LED_COLOURS: [CableColor, string][] = [
  ["green", "#4fd16b"], ["blue", "#4b8dff"], ["red", "#ff4a4a"], ["orange", "#ff9a3a"], ["white", "#f4f4f0"], ["purple", "#a776ff"],
];
export function ledHex(led?: string): string | undefined {
  if (!led || led === "bi") return undefined;
  return LED_COLOURS.find(([n]) => n === led)?.[1] ?? cableHex(led);
}

/**
 * A sequencer track set to CV output drives A n (pitch), B n (velocity/mod) and Gate n
 * (Reliq manual v1.10.0, p94). Returns the track number for a CV or Gate jack.
 */
export function trackOf(id: JackId | null | undefined): number | null {
  if (!id) return null;
  const m = /^cv(\d+)[ab]$/.exec(id) || /^g(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}
export const trackJacks = (n: number): JackId[] => [`cv${n}a`, `cv${n}b`, `g${n}`];
export const KIND_OF: Record<"a" | "b" | "g", string> = { a: "pitch", b: "velocity / mod", g: "gate" };
export function kindOf(id: JackId): "a" | "b" | "g" {
  return id.startsWith("g") ? "g" : (id.slice(-1) as "a" | "b");
}

/** CV/Gate Standard options (manual p95). */
export const CV_STANDARDS = [
  "1V/Oct – Normal", "1.2V/Oct – Normal", "Hz/V – Normal",
  "1V/Oct – Inverted", "1.2V/Oct – Inverted", "Hz/V – Inverted",
];

/** Breakout Module Settings (manual p388). */
export const RESET_MODES: { value: "RESET" | "RUN" | "TRIGGER ON STOP"; label: string; short: string }[] = [
  { value: "RESET", label: "Reset: pulse at start of playback", short: "reset" },
  { value: "RUN", label: "Run: high while playing", short: "run" },
  { value: "TRIGGER ON STOP", label: "Trigger on stop", short: "on stop" },
];
export const GATE_RANGES: { value: "10" | "5"; label: string }[] = [
  { value: "10", label: "0–10 V" },
  { value: "5", label: "0–5 V" },
];
export const CLOCK_DIVISIONS = ["1 bar", "1/2", "1/4", "1/8", "1/16", "1/32", "1/96 (24 PPQN)"];
