import type { ModuleDef, Signal } from "./types";

/**
 * Colour-coding for module jacks. The library records each jack's signal type; for jacks
 * it doesn't know (custom modules, jacks you've added) the type is guessed from the name.
 */
const RULES: [Signal, RegExp][] = [
  ["clock", /\b(clk|clock|reset|rst|run)\b/i],
  ["any", /\bmidi\b/i],
  ["gate", /trig|gate|strike|strum|\btap\b|capture|freeze|clear|erase|\brec\b|record|play\/res|retrig|learn|onset|\b(and|or|xor|nand|nor|xnor|not) (in|out)\b/i],
  ["pitch", /v\/o|1v\/oct|\bpitch\b|kb cv/i],
  ["audio", /audio|phones|main out|mix out|^(l|r) out$|^(left|right) (in|out)$|^(in|out) (l|r)$|\bfx\d|\baux (in|out)$|\bvco\b|\bsine\b|\btri\b|\bsub\b|noise|square|^(hp|lp|bp)$|\bfm\b/i],
  ["cv", /\bcv\b|\bmod\b|\blfo\b|^eg$|s\+h|pressure|cutoff|shape|morph|timbre|level|decay|release|attack|sustain|rate|depth|position|^pwm/i],
];

export function guessSignal(jack: string): Signal {
  for (const [s, rx] of RULES) if (rx.test(jack)) return s;
  return "any";
}

export function signalOf(mod: Pick<ModuleDef, "signals"> | undefined, jack: string): Signal {
  const own = mod?.signals && Object.hasOwn(mod.signals, jack) ? mod.signals[jack] : undefined;
  return own ?? guessSignal(jack);
}

export const SIGNAL_LABEL: Record<Signal, string> = {
  audio: "Audio",
  cv: "CV / modulation",
  pitch: "Pitch (V/oct)",
  gate: "Gate / trigger",
  clock: "Clock / reset",
  any: "Any / depends",
};
