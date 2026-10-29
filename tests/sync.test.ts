import { test } from "node:test";
import assert from "node:assert/strict";
import { formatKey, generateSyncKey, isValidKey, normaliseKey, shouldApply, type RemoteState } from "../src/lib/sync";

const remote = (over: Partial<RemoteState> = {}): RemoteState => ({
  deleted: false,
  client_updated_at: "2026-10-22T12:00:00.000Z",
  ...over,
});

test("sync keys are long, valid and survive being retyped", () => {
  const k = generateSyncKey();
  assert.equal(k.length, 32);
  assert.ok(isValidKey(k));
  assert.doesNotMatch(k, /[01OIL U]/);
  assert.equal(normaliseKey(formatKey(k).toLowerCase()), k);
  assert.equal(normaliseKey(` ${formatKey(k)} \n`), k);
  assert.ok(!isValidKey(k.slice(0, 20)), "a truncated key is rejected");
  assert.notEqual(generateSyncKey(), k);
});

test("remote records apply when newer, never when older", () => {
  assert.ok(shouldApply(undefined, undefined, remote()), "new record arrives");
  assert.ok(!shouldApply(undefined, undefined, remote({ deleted: true })), "deletion of something we never had");
  assert.ok(shouldApply({ updatedAt: "2026-10-22T11:00:00.000Z" }, undefined, remote()), "remote is newer");
  assert.ok(!shouldApply({ updatedAt: "2026-10-22T13:00:00.000Z" }, {}, remote()), "local unpushed edit is newer");
  assert.ok(!shouldApply({ updatedAt: "2026-10-22T12:00:00.000Z" }, undefined, remote()), "same time: keep ours");
  assert.ok(shouldApply({ updatedAt: "2026-10-22T11:00:00.000Z" }, undefined, remote({ deleted: true })), "newer deletion removes ours");
});

test("an unpushed local deletion beats an older remote edit but not a newer one", () => {
  assert.ok(!shouldApply(undefined, { deletedAt: "2026-10-22T13:00:00.000Z" }, remote()));
  assert.ok(shouldApply(undefined, { deletedAt: "2026-10-22T11:00:00.000Z" }, remote()));
});

test("a pasted sync link, key or garbage link is read safely", async () => {
  const { keyFromInput } = await import("../src/lib/sync");
  const k = generateSyncKey();
  assert.equal(keyFromInput(`https://patchbook-for-reliq.vercel.app/#sync=${k}`), k);
  assert.equal(keyFromInput(` patchbook-for-reliq.vercel.app/#sync=${formatKey(k)}\n`), k);
  assert.equal(keyFromInput(`https://patchbook.tripswit.ch/#sync=${k}`), k, "links from the custom domain");
  assert.equal(keyFromInput(formatKey(k).toLowerCase()), k);
  assert.equal(keyFromInput("https://patchbook-for-reliq.vercel.app/"), "", "a link with no key isn't a key");
  assert.equal(keyFromInput("https://patchbook-for-reliq.vercel.app/#share=abcdefghijklmnopqrstuvwxyz0123"), "");
});
