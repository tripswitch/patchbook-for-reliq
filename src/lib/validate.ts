/**
 * Hand-rolled checks matching modules/schema.json, so the app and the CI script
 * share one validator without pulling in a JSON Schema library.
 */
import { SIGNALS } from "./types";

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SIGNAL_SET = new Set<string>(SIGNALS);
const KEYS = new Set([
  "id", "name", "maker", "hp", "modulargrid", "inputs", "outputs", "signals",
  "confidence", "source", "notes", "contributors",
]);

function isStr(v: unknown, min = 1, max = Infinity): v is string {
  return typeof v === "string" && v.trim().length >= min && v.length <= max;
}

function checkJacks(v: unknown, field: string, out: string[]) {
  if (!Array.isArray(v)) {
    out.push(`${field} must be a list`);
    return;
  }
  const seen = new Set<string>();
  v.forEach((j, i) => {
    if (!isStr(j, 1, 24)) out.push(`${field}[${i}] must be 1–24 characters`);
    else if (seen.has(j)) out.push(`${field} lists "${j}" twice`);
    else seen.add(j);
  });
}

export function validateModule(m: unknown): string[] {
  const out: string[] = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["must be a JSON object"];
  const o = m as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.has(k)) out.push(`unknown field "${k}"`);
  if (!isStr(o.id) || !ID.test(o.id as string)) out.push("id must be lowercase words joined by hyphens");
  if (!isStr(o.name, 1, 60)) out.push("name is required (max 60 characters)");
  if (!isStr(o.maker, 1, 60)) out.push("maker is required (max 60 characters)");
  if (o.hp !== undefined && !(Number.isInteger(o.hp) && (o.hp as number) >= 1 && (o.hp as number) <= 168))
    out.push("hp must be a whole number from 1 to 168");
  if (o.modulargrid !== undefined) {
    const mg = o.modulargrid as Record<string, unknown>;
    if (!mg || typeof mg !== "object") out.push("modulargrid must be an object");
    else {
      if (mg.url !== undefined && !(isStr(mg.url) && (mg.url as string).startsWith("https://modulargrid.net/e/")))
        out.push("modulargrid.url must start with https://modulargrid.net/e/");
      if (mg.listedAs !== undefined && !isStr(mg.listedAs)) out.push("modulargrid.listedAs must be text");
      for (const k of Object.keys(mg)) if (k !== "url" && k !== "listedAs") out.push(`unknown field "modulargrid.${k}"`);
    }
  }
  checkJacks(o.inputs, "inputs", out);
  checkJacks(o.outputs, "outputs", out);
  if (Array.isArray(o.inputs) && Array.isArray(o.outputs) && o.inputs.length + o.outputs.length === 0)
    out.push("a module needs at least one jack");
  if (o.signals !== undefined) {
    const sg = o.signals as Record<string, unknown>;
    const jacks = new Set([...(Array.isArray(o.inputs) ? o.inputs : []), ...(Array.isArray(o.outputs) ? o.outputs : [])]);
    if (!sg || typeof sg !== "object" || Array.isArray(sg)) out.push("signals must be an object of jack name → type");
    else
      for (const [k, v] of Object.entries(sg)) {
        if (!jacks.has(k)) out.push(`signals names "${k}", which isn't one of the module's jacks`);
        if (!SIGNAL_SET.has(v as string)) out.push(`signals."${k}" must be one of ${[...SIGNAL_SET].join(", ")}`);
      }
  }
  if (!["high", "medium", "low"].includes(o.confidence as string)) out.push('confidence must be "high", "medium" or "low"');
  if (!isStr(o.source, 3)) out.push("source is required: the manual page or URL the jacks came from");
  if (o.notes !== undefined && typeof o.notes !== "string") out.push("notes must be text");
  if (o.contributors !== undefined && !(Array.isArray(o.contributors) && o.contributors.every((c) => isStr(c))))
    out.push("contributors must be a list of names");
  return out;
}
