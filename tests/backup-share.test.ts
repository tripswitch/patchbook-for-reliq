import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBackup, parseBackup, ImportError } from "../src/lib/backup";
import { decodeShare, encodeShare } from "../src/lib/share";
import type { Patch } from "../src/lib/types";

const patch: Patch = {
  id: "p1",
  name: "Night Bus",
  notes: "Plaits on Track 5 — 120 BPM",
  updatedAt: "2026-10-22T10:00:00.000Z",
  jacks: {
    cv5a: { color: "blue", mod: "mutable-instruments-plaits", to: "V/OCT" },
    mi3: { color: "black", mod: "vpme-qex", to: "OUT 3", note: "Drum 3" },
  },
  tracks: { "5": { name: "Plaits Noise", mod: "mutable-instruments-plaits" } },
  brk: { clock: "1/16", reset: "RUN", gate: "10" },
};

test("backups round-trip", () => {
  const b = makeBackup([patch], [{ id: "r1", name: "Test rack", modules: ["mutable-instruments-plaits"] }], []);
  const back = parseBackup(JSON.stringify(b));
  assert.deepEqual(back.patches[0], patch);
  assert.equal(back.racks[0].modules[0], "mutable-instruments-plaits");
});

test("import drops unknown jacks and bad fields instead of failing", () => {
  const b = makeBackup([{ ...patch, jacks: { ...patch.jacks, zz9: { to: "x" } }, brk: { gate: "12" as never } }], [], []);
  const back = parseBackup(JSON.stringify(b));
  assert.equal(back.patches[0].jacks.zz9, undefined);
  assert.deepEqual(back.patches[0].brk, {});
});

test("import explains what's wrong with a bad file", () => {
  assert.throws(() => parseBackup("not json"), ImportError);
  assert.throws(() => parseBackup('{"format":"something-else"}'), /isn't a Patchbook backup/);
  assert.throws(() => parseBackup('{"format":"patchbook-for-reliq","schemaVersion":99}'), /newer version/);
});

test("share links round-trip through deflate + base64url", async () => {
  const token = await encodeShare(patch, []);
  assert.match(token, /^[A-Za-z0-9_-]+$/, "URL-safe");
  const back = await decodeShare(token);
  assert.deepEqual(back.patch, patch);
});

test("a damaged share link gives a clear error", async () => {
  const token = await encodeShare(patch, []);
  await assert.rejects(decodeShare(token.slice(0, 20)), /damaged or incomplete/);
});
