import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { guessSignal, signalOf } from "../src/lib/signals";
import { validateModule } from "../src/lib/validate";
import { SIGNALS, type ModuleDef } from "../src/lib/types";

const mods: ModuleDef[] = readdirSync("modules")
  .filter((f) => f.endsWith(".json") && f !== "schema.json")
  .map((f) => JSON.parse(readFileSync(`modules/${f}`, "utf8")));

test("every library jack has a signal type", () => {
  for (const m of mods)
    for (const j of [...m.inputs, ...m.outputs]) assert.ok(m.signals && SIGNALS.includes(m.signals[j]), `${m.id} › ${j}`);
});

test("spot checks against what the modules do", () => {
  const get = (id: string, j: string) => signalOf(mods.find((m) => m.id === id), j);
  assert.equal(get("mutable-instruments-plaits", "V/OCT"), "pitch");
  assert.equal(get("mutable-instruments-plaits", "OUT"), "audio");
  assert.equal(get("mutable-instruments-plaits", "TRIG"), "gate");
  assert.equal(get("instruo-harmonaig", "R"), "pitch");
  assert.equal(get("alm-pamelas-pro-workout", "CLK"), "clock");
  assert.equal(get("instruo-lubadh", "AUX IN XFADE CV"), "cv");
});

test("unknown jacks are guessed from their name", () => {
  assert.equal(guessSignal("1V/OCT 2"), "pitch");
  assert.equal(guessSignal("GATE IN"), "gate");
  assert.equal(guessSignal("CLOCK IN"), "clock");
  assert.equal(guessSignal("FILTER CV"), "cv");
  assert.equal(guessSignal("MAIN OUT L"), "audio");
  assert.equal(guessSignal("X"), "any");
  assert.equal(signalOf(undefined, "TRIG"), "gate");
});

test("the validator checks signal types", () => {
  const base = { id: "a-b", name: "B", maker: "A", inputs: ["IN"], outputs: ["OUT"], confidence: "high", source: "manual p1" };
  assert.deepEqual(validateModule({ ...base, signals: { IN: "audio", OUT: "audio" } }), []);
  assert.ok(validateModule({ ...base, signals: { IN: "loud" } }).some((e) => e.includes("must be one of")));
  assert.ok(validateModule({ ...base, signals: { NOPE: "cv" } }).some((e) => e.includes("isn't one of")));
});
