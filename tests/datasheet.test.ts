import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { matchDataSheet } from "../src/lib/datasheet";
import type { ModuleDef } from "../src/lib/types";

const dir = new URL("../modules/", import.meta.url);
const mods: ModuleDef[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "schema.json")
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));

// Text as copied from a ModularGrid rack Data Sheet page.
const SHEET = `Test Case 104HP - Rack Data Sheet example-user
Module	Row	Width	Depth	+12V	-12V	+5V
	Transient Modules 7J
Compact Joystick	1 	8 HP 	38 mm 	35 mA 	25 mA 	0 mA
	Thonk Plinky Expander
Expander for Plinky	1 	4 HP 	23 mm
	Thonk Plinky
polyphonic touch synth	2 	24 HP 	12 mm
	Winterbloom Castor & Pollux II
Dual Juno-inspired oscillator	2 	14 HP
	Winterbloom Castor & Pollux II (expander)
Output Expander	2 	2 HP
	Instruō Lúbadh
Stereo looper	2 	20 HP
	Instruō Lúbadh expander
	Mutable instruments Plaits
	Mutable instruments Plaits
	Example Power 6U Supply
	Big T Music ベールズ (VEILS)`;

test("finds modules from a pasted data sheet, longest names first", () => {
  const found = Object.fromEntries(matchDataSheet(SHEET, mods).map((m) => [m.id, m.count]));
  assert.equal(found["transient-modules-7j"], 1);
  assert.equal(found["thonk-plinky"], 1, "Plinky Expander must not also count as Plinky");
  assert.equal(found["thonk-plinky-expander"], 1);
  assert.equal(found["winterbloom-castor-pollux-ii"], 1);
  assert.equal(found["winterbloom-castor-pollux-ii-expander"], 1);
  assert.equal(found["instruo-lubadh"], 1);
  assert.equal(found["instruo-lubadh-expander"], 1);
  assert.equal(found["mutable-instruments-plaits"], 2, "same module twice in one rack");
  assert.equal(found["big-t-music-veils"], 1, "matches through Japanese characters");
  assert.equal(Object.keys(found).length, 9, "power supply is not in the library");
});

test("returns nothing for unrelated text", () => {
  assert.deepEqual(matchDataSheet("shopping list: milk, eggs", mods), []);
});
