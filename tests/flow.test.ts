import { test } from "node:test";
import assert from "node:assert/strict";
import { WALK, jackUse, nextJack, prevJack, rankJacks, searchModules, suggestedModules } from "../src/lib/flow";
import { buildLibrary } from "../src/lib/library";
import type { ModuleDef, Patch } from "../src/lib/types";

const mods: ModuleDef[] = [
  { id: "mi-plaits", name: "Plaits", maker: "Mutable Instruments", inputs: ["V/OCT", "MODEL", "TIMBRE CV", "FM", "MORPH CV", "TRIG", "LEVEL"], outputs: ["OUT", "AUX"], confidence: "high", source: "test" },
  { id: "instruo-lubadh", name: "Lúbadh", maker: "Instruo", inputs: ["IN A", "IN B"], outputs: ["OUT A", "OUT B"], confidence: "high", source: "test" },
];
const lib = buildLibrary(mods, []);
const patch: Patch = {
  id: "p", name: "t", notes: "", updatedAt: "2026-10-22T00:00:00Z", brk: {},
  tracks: { "5": { name: "Plaits", mod: "mi-plaits" } },
  jacks: { cv5a: { mod: "mi-plaits", to: "V/OCT" }, mi1: { mod: "instruo-lubadh", to: "OUT A" } },
};

test("Next walks matrix by number, then a voice at a time", () => {
  assert.equal(WALK.length, 82);
  assert.equal(nextJack("mi16"), "mo1");
  assert.equal(nextJack("cv5a"), "cv5b");
  assert.equal(nextJack("cv5b"), "g5");
  assert.equal(nextJack("g5"), "cv6a");
  assert.equal(nextJack("g16"), "clk");
  assert.equal(nextJack("rst"), null);
  assert.equal(prevJack("mi1"), null);
  assert.equal(prevJack("cv6a"), "g5");
});

test("likely jacks come first, and only when they narrow it down", () => {
  const ins = mods[0].inputs;
  assert.deepEqual(rankJacks("cv5a", ins).slice(0, 1), [{ name: "V/OCT", suggested: true }]);
  assert.equal(rankJacks("g5", ins)[0].name, "TRIG");
  const b = rankJacks("cv5b", ins).filter((x) => x.suggested).map((x) => x.name);
  assert.ok(!b.includes("MODEL"), "MODEL isn't a modulation input");
  assert.ok(b.includes("LEVEL"));
  assert.equal(rankJacks("cv5a", ["A", "B"]).some((x) => x.suggested), false);
});

test("module suggestions: the jack walked from, the track's voice, then the patch", () => {
  assert.equal(suggestedModules(patch, "cv5b", lib, "cv5a")[0], "mi-plaits");
  assert.deepEqual(new Set(suggestedModules(patch, "mi2", lib)), new Set(["mi-plaits", "instruo-lubadh"]));
  assert.deepEqual(jackUse(patch, "mi-plaits", "cv6a"), new Map([["V/OCT", "A 5"]]));
  assert.equal(jackUse(patch, "mi-plaits", "cv5a").size, 0);
});

test("module search ignores case and accents", () => {
  assert.deepEqual(searchModules(lib, "lubadh"), ["instruo-lubadh"]);
  assert.deepEqual(searchModules(lib, "mutable PLA"), ["mi-plaits"]);
  assert.deepEqual(searchModules(lib, "  "), []);
});

test("every module in the patch is offered, not just the first few", () => {
  const many: ModuleDef[] = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, maker: "X", inputs: ["IN"], outputs: ["OUT"], confidence: "high" as const, source: "t" }));
  const lib2 = buildLibrary(many, []);
  const p: Patch = { ...patch, tracks: {}, jacks: Object.fromEntries(many.map((m, i) => [`g${i + 1}`, { mod: m.id }])) };
  assert.equal(suggestedModules(p, "cv1a", lib2).length, 10);
});
