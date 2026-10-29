import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { validateModule } from "../src/lib/validate";
import { buildLibrary, guessJack, GUESS_PATTERNS, jackList } from "../src/lib/library";
import type { ModuleDef } from "../src/lib/types";

const dir = new URL("../modules/", import.meta.url);
const mods: ModuleDef[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "schema.json")
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));

test("every library module passes validation", () => {
  for (const m of mods) assert.deepEqual(validateModule(m), [], m.id);
});

test("validator catches the common mistakes", () => {
  const bad = validateModule({ id: "Bad Id", name: "", maker: "X", inputs: ["A", "A"], outputs: [], confidence: "sure", source: "" });
  assert.ok(bad.some((e) => e.startsWith("id")));
  assert.ok(bad.some((e) => e.startsWith("name")));
  assert.ok(bad.some((e) => e.includes("twice")));
  assert.ok(bad.some((e) => e.startsWith("confidence")));
  assert.ok(bad.some((e) => e.startsWith("source")));
  assert.ok(validateModule({ ...mods[0], extra: 1 }).some((e) => e.includes("unknown field")));
});

test("Matrix In jacks list a module's outputs; everything else lists its inputs", () => {
  const lib = buildLibrary(mods, []);
  assert.deepEqual(jackList(lib, "mutable-instruments-plaits", "in"), ["OUT", "AUX"]);
  assert.ok(jackList(lib, "mutable-instruments-plaits", "out")!.includes("V/OCT"));
  assert.equal(jackList(lib, "music-thing-pulses-mk-ii", "out"), null, "Pulses has no inputs");
});

test("pitch and gate guesses pick a single matching jack", () => {
  const lib = buildLibrary(mods, []);
  assert.equal(guessJack(lib, "mutable-instruments-plaits", GUESS_PATTERNS.a), "V/OCT");
  assert.equal(guessJack(lib, "mutable-instruments-plaits", GUESS_PATTERNS.g), "TRIG");
  assert.equal(guessJack(lib, "instruo-troika", GUESS_PATTERNS.a), "", "three 1V/OCT inputs is ambiguous");
});

test("local edits and custom modules apply on top of the library", () => {
  const lib = buildLibrary(mods, [
    { id: "mutable-instruments-plaits", inputs: ["V/OCT", "NEW"], updatedAt: "" },
    { id: "custom-maths", custom: true, name: "Maths", maker: "Make Noise", inputs: ["CH1 IN"], outputs: ["CH1 OUT"], updatedAt: "" },
  ]);
  assert.deepEqual(lib.get("mutable-instruments-plaits")!.inputs, ["V/OCT", "NEW"]);
  assert.deepEqual(lib.get("mutable-instruments-plaits")!.outputs, ["OUT", "AUX"]);
  assert.equal(lib.get("custom-maths")!.custom, true);
  assert.equal(lib.size, mods.length + 1);
});
