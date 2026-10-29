import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPatch, cleanOverride } from "../src/lib/backup";
import { cableHex, cableName, isDark, ledHex } from "../src/lib/panel";
import { customColours, patchAsText } from "../src/lib/patch";
import { buildLibrary, toLibraryJson } from "../src/lib/library";
import type { ModuleDef } from "../src/lib/types";

const raw = (jacks: Record<string, unknown>) => ({ id: "p", name: "P", notes: "", updatedAt: "2026-10-25T10:00:00Z", jacks, tracks: {}, brk: {} });

test("custom colours and LED plugs survive cleaning; junk doesn't", () => {
  const p = cleanPatch(raw({ cv1a: { color: "#2BB5A5", led: "bi" }, cv1b: { color: "red", led: "green" }, g1: { color: "red; background:url(x)", led: "disco" } }));
  assert.deepEqual(p.jacks.cv1a, { color: "#2bb5a5", led: "bi" });
  assert.deepEqual(p.jacks.cv1b, { color: "red", led: "green" });
  assert.equal(p.jacks.g1, undefined);
});

test("colour helpers", () => {
  assert.equal(cableHex("red"), "#d64545");
  assert.equal(cableHex("#123456"), "#123456");
  assert.equal(cableHex("nope"), undefined);
  assert.equal(cableName("#2bb5a5"), "custom #2bb5a5");
  assert.equal(ledHex("bi"), undefined);
  assert.equal(ledHex("green"), "#4fd16b");
  assert.ok(isDark("#101010") && !isDark("#f1f1ee"));
});

test("your custom colours are collected from patches, newest first", () => {
  const a = cleanPatch({ ...raw({ cv1a: { color: "#111111" } }), id: "a", updatedAt: "2026-10-01T00:00:00Z" });
  const b = cleanPatch({ ...raw({ cv1a: { color: "#222222" }, cv2a: { color: "red" } }), id: "b", updatedAt: "2026-10-20T00:00:00Z" });
  assert.deepEqual(customColours([a, b]), ["#222222", "#111111"]);
});

test("text export names custom colours and LEDs", () => {
  const p = cleanPatch(raw({ cv1a: { mod: "x", color: "#2bb5a5", led: "bi" } }));
  assert.match(patchAsText(p, new Map()), /\[custom #2bb5a5, LED: bi-colour\]/);
});

test("your jack type corrections merge over the library and travel with it", () => {
  const base: ModuleDef[] = [{ id: "m", name: "M", maker: "X", inputs: ["IN"], outputs: ["OUT"], signals: { IN: "audio", OUT: "audio" }, confidence: "high", source: "t" }];
  const o = cleanOverride({ id: "m", inputs: ["IN"], outputs: ["OUT"], signals: { OUT: "cv", IN: "loud" }, updatedAt: "2026-10-25T00:00:00Z" })!;
  assert.deepEqual(o.signals, { OUT: "cv" }, "invalid types are dropped");
  const lib = buildLibrary(base, [o]);
  assert.deepEqual(lib.get("m")!.signals, { IN: "audio", OUT: "cv" });
  assert.deepEqual(toLibraryJson(lib.get("m")!).signals, { IN: "audio", OUT: "cv" });
  assert.equal("librarySignals" in toLibraryJson(lib.get("m")!), false);
});
