import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveVault, itemId, open, seal } from "../src/lib/vault";
import { generateSyncKey, isValidKey, keyFromInput } from "../src/lib/sync";
import { cleanOverride, cleanPatch, cleanRack, LIMITS, parseBackup } from "../src/lib/backup";
import { cableHex, isCableColour } from "../src/lib/panel";
import { signalOf } from "../src/lib/signals";
import { clampTime } from "../src/lib/util";
import { decodeShare, MAX_SHARE_TOKEN } from "../src/lib/share";

test("vault keys: same key gives the same token and item ids; different keys don't", async () => {
  const k = generateSyncKey();
  const a = await deriveVault(k), b = await deriveVault(k), c = await deriveVault(generateSyncKey());
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.equal(a.token, b.token);
  assert.notEqual(a.token, c.token);
  assert.ok(!a.token.includes(k.toLowerCase()), "the token isn't the key");
  const i1 = await itemId(a, "patch", "p1"), i2 = await itemId(b, "patch", "p1");
  assert.equal(i1, i2);
  assert.match(i1, /^[0-9a-f]{64}$/);
  assert.notEqual(i1, await itemId(a, "rack", "p1"));
  assert.notEqual(i1, await itemId(c, "patch", "p1"));
});

test("sealed records only open with the right key and item, and can't be altered", async () => {
  const k = await deriveVault(generateSyncKey());
  const item = await itemId(k, "patch", "p1");
  const value = { kind: "patch", id: "p1", data: { name: "Secret patch", notes: "Lúbadh → Matrix 3" } };
  const blob = await seal(k, item, value);
  assert.ok(!blob.includes("Secret"), "the blob is ciphertext");
  assert.deepEqual(await open(k, item, blob), value);
  assert.equal(await open(await deriveVault(generateSyncKey()), item, blob), null, "wrong key");
  assert.equal(await open(k, await itemId(k, "patch", "p2"), blob), null, "blob moved to another item");
  const bytes = Buffer.from(blob, "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.equal(await open(k, item, bytes.toString("base64")), null, "tampered");
  assert.notEqual(await seal(k, item, value), blob, "fresh IV each time");
});

test("only keys this app could have made are accepted", () => {
  const k = generateSyncKey();
  assert.ok(isValidKey(k));
  assert.ok(!isValidKey("A".repeat(24)), "too short");
  assert.ok(!isValidKey("A".repeat(31) + "0"), "0 isn't in the alphabet");
  assert.ok(!isValidKey(k + "A"), "too long");
  assert.equal(keyFromInput(`https://x.example/#sync=${k}`), k);
});

test("timestamps are validated and clamped", () => {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  assert.ok(Date.parse(clampTime(future)) <= Date.now() + 86_400_000 + 1000);
  assert.ok(Math.abs(Date.parse(clampTime("not a date")) - Date.now()) < 5000);
  assert.equal(clampTime("2026-10-01T00:00:00.000Z"), "2026-10-01T00:00:00.000Z");
});

test("cleaners enforce lengths and ignore prototype keys", () => {
  const big = "x".repeat(50_000);
  const raw = JSON.parse(`{"id":"p1","name":"${"n".repeat(500)}","notes":"${big}","updatedAt":"2999-01-01T00:00:00Z",
    "jacks":{"__proto__":{"role":"evil"},"constructor":{"role":"x"},"cv1a":{"note":"${big}","color":"constructor","led":"toString"}},
    "tracks":{"01":{"name":"x"},"1":{"name":"${big}"}},"brk":{}}`);
  const p = cleanPatch(raw);
  assert.equal(p.name.length, LIMITS.name);
  assert.equal(p.notes.length, LIMITS.notes);
  assert.equal(p.jacks.cv1a.note!.length, LIMITS.note);
  assert.equal(p.jacks.cv1a.color, undefined);
  assert.equal(p.jacks.cv1a.led, undefined);
  assert.deepEqual(Object.keys(p.jacks), ["cv1a"]);
  assert.equal(Object.getPrototypeOf(p.jacks), Object.prototype);
  assert.deepEqual(Object.keys(p.tracks), ["1"]);
  assert.equal(p.tracks["1"].name!.length, LIMITS.trackName);
  assert.ok(Date.parse(p.updatedAt) < Date.now() + 2 * 86_400_000);
  assert.throws(() => cleanPatch({ id: "../../etc", name: "x" }), /no id/);
  assert.equal(cleanRack({ id: "r1", name: "R", modules: Array(1000).fill("m") })!.modules.length, LIMITS.rackModules);
  const o = cleanOverride({ id: "m", inputs: ["IN", "__proto__", "x".repeat(40)], signals: { __proto__: "cv", IN: "audio", constructor: "cv" }, hp: 9999, updatedAt: "x" })!;
  assert.deepEqual(o.inputs, ["IN", "x".repeat(LIMITS.jackName)]);
  assert.deepEqual(o.signals, { IN: "audio" });
  assert.equal(o.hp, undefined);
});

test("colour and signal lookups use own properties only", () => {
  assert.equal(isCableColour("constructor"), false);
  assert.equal(cableHex("toString"), undefined);
  assert.equal(signalOf({ signals: { OUT: "audio" } }, "constructor"), "any");
});

test("backups are capped in size", () => {
  const patches = Array.from({ length: LIMITS.patches + 50 }, (_, i) => ({ id: `p${i}`, name: "P" }));
  const b = parseBackup(JSON.stringify({ format: "patchbook-for-reliq", schemaVersion: 1, patches, racks: [], moduleOverrides: [] }));
  assert.equal(b.patches.length, LIMITS.patches);
});

test("share links that are too big, or expand too far, are refused", async () => {
  await assert.rejects(decodeShare("A".repeat(MAX_SHARE_TOKEN + 1)), /too large/);
  // ~5 MB of zeros compresses to a few KB: a decompression bomb.
  const zeros = new Uint8Array(5 * 1024 * 1024);
  const compressed = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  let bin = "";
  for (let i = 0; i < compressed.length; i += 0x8000) bin += String.fromCharCode(...compressed.subarray(i, i + 0x8000));
  const token = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.ok(token.length < MAX_SHARE_TOKEN);
  await assert.rejects(decodeShare(token), /too large/);
});
