/** Breakout Module jack ids: mi1–16, mo1–16, cv1a–cv16b, g1–16, clk, rst. */
export type JackId = string;

export type Zone = "audio" | "cv" | "gate" | "sync";

/** "in" = signal goes into the Reliq (Matrix inputs). Everything else is an output from the Reliq. */
export type Direction = "in" | "out";

export interface JackDef {
  id: JackId;
  /** Label as printed on the panel, e.g. "IN 3", "A 5", "GATE 12". */
  label: string;
  /** Name used in the editor and the connection sheet, e.g. "Matrix In 3". */
  name: string;
  dir: Direction;
  zone: Zone;
}

export interface JackData {
  /** What the Reliq is doing on this jack. Falls back to the track label when empty. */
  role?: string;
  /** Module id from the library. */
  mod?: string;
  /** Jack on that module, or free text for anything outside the library. */
  to?: string;
  /** One of the standard colours, or a custom colour as #rrggbb. */
  color?: CableColor | HexColour;
  /** The cable has LED plugs: "bi" for a two-colour (polarity) LED, or the glow colour. */
  led?: "bi" | CableColor | HexColour;
  note?: string;
}

export interface Track {
  name?: string;
  /** CV/Gate standard as set in Reliq's track settings. */
  std?: string;
  /** Track uses a custom output routing, so A n / B n / Gate n are not labelled as this track. */
  custom?: boolean;
  /** Voice module this track usually plays. */
  mod?: string;
}

export interface BreakoutSettings {
  clock?: string;
  reset?: "RESET" | "RUN" | "TRIGGER ON STOP";
  gate?: "10" | "5";
}

export interface Patch {
  id: string;
  name: string;
  notes: string;
  updatedAt: string;
  jacks: Record<JackId, JackData>;
  tracks: Record<string, Track>;
  brk: BreakoutSettings;
}

/** What a module jack carries. "any" = DC-coupled or depends on settings (interfaces, utilities, multis). */
export type Signal = "audio" | "cv" | "pitch" | "gate" | "clock" | "any";
export const SIGNALS: Signal[] = ["audio", "cv", "pitch", "gate", "clock", "any"];

export interface ModuleDef {
  id: string;
  name: string;
  maker: string;
  hp?: number;
  modulargrid?: { url?: string; listedAs?: string };
  inputs: string[];
  outputs: string[];
  /** Signal type per jack name. Jacks missing here are guessed from their name. */
  signals?: Record<string, Signal>;
  confidence: "high" | "medium" | "low";
  source: string;
  notes?: string;
  contributors?: string[];
}

/**
 * A user's local change to a module: edited jack lists for a library module,
 * or a whole module that isn't in the library yet (custom: true).
 */
export interface ModuleOverride {
  id: string;
  inputs?: string[];
  outputs?: string[];
  custom?: boolean;
  name?: string;
  maker?: string;
  hp?: number;
  /** Your corrections to jack signal types, keyed by jack name. */
  signals?: Record<string, Signal>;
  updatedAt: string;
}

export interface Rack {
  id: string;
  name: string;
  /** Module ids in rack order. */
  modules: string[];
  updatedAt?: string;
}

export type HexColour = `#${string}`;

export type CableColor =
  | "red" | "orange" | "yellow" | "green" | "blue"
  | "purple" | "pink" | "white" | "grey" | "black";

export const BACKUP_FORMAT = "patchbook-for-reliq";
export const SCHEMA_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  patches: Patch[];
  racks: Rack[];
  moduleOverrides: ModuleOverride[];
}

export interface SharePayload {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  kind: "patch";
  patch: Patch;
  /** Custom modules the patch refers to, so the link works for people who don't have them. */
  modules: ModuleOverride[];
}
