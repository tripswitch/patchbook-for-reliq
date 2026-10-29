import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { breakoutSummary, derivedRole, patchAsText, roleText } from "../src/lib/patch";
import { buildLibrary } from "../src/lib/library";
import type { ModuleDef, Patch } from "../src/lib/types";

const dir = new URL("../modules/", import.meta.url);
const lib = buildLibrary(
  readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "schema.json").map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as ModuleDef),
  [],
);
const p: Patch = {
  id: "p", name: "Test", notes: "", updatedAt: "",
  jacks: { cv3a: { mod: "mutable-instruments-plaits", to: "V/OCT" }, g3: { role: "Accent" } },
  tracks: { "3": { name: "Plaits bass" }, "4": { name: "Drums", custom: true } },
  brk: { clock: "1/16", reset: "TRIGGER ON STOP", gate: "5" },
};

test("a named track labels its A, B and Gate jacks", () => {
  assert.equal(derivedRole(p, "cv3a"), "Track 3 Plaits bass · pitch");
  assert.equal(derivedRole(p, "cv3b"), "Track 3 Plaits bass · velocity / mod");
  assert.equal(derivedRole(p, "g3"), "Track 3 Plaits bass · gate");
  assert.equal(roleText(p, "g3"), "Accent", "typed text wins over the track label");
});

test("custom routing and Matrix jacks get no track label", () => {
  assert.equal(derivedRole(p, "cv4a"), "");
  assert.equal(derivedRole(p, "mi3"), "");
});

test("breakout summary and text export", () => {
  assert.equal(breakoutSummary(p).replace(/ /g, " "), "CLK 1/16 · RST on stop · Gates 0–5V");
  const t = patchAsText(p, lib);
  assert.match(t, /CV A3 \(out of reliq\): Track 3 Plaits bass · pitch → Plaits › V\/OCT/);
  assert.match(t, /## Tracks/);
});
