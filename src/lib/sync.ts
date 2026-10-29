import { storage, onLocalChange, type ItemKind } from "./storage";
import { cleanOverride, cleanPatch, cleanRack, makeBackup } from "./backup";
import { clampTime, nowIso } from "./util";
import { deriveVault, itemId, open, seal, type VaultKeys } from "./vault";
import type { Backup } from "./types";

/**
 * Device sync, optional and off by default. End-to-end encrypted.
 *
 * One device creates a private sync key; other devices join with it (usually by opening a
 * link that carries the key in its #fragment). The key never leaves the devices: from it each
 * device derives a vault token (to find the sync space on the server), an encryption key and an
 * item-id key (see vault.ts). Every local change is queued, encrypted and pushed to a Supabase
 * database through SQL functions (supabase/migrations/0001_sync.sql); other devices pull what
 * changed since they last looked. Conflicts resolve last-write-wins on each record's updatedAt.
 * The app keeps working offline and catches up when it's back.
 */

// import.meta.env is undefined outside Vite (e.g. in the node test runner).
const ENV: Partial<ImportMetaEnv> = import.meta.env ?? {};
const URL_ = ENV.VITE_SYNC_URL;
const ANON = ENV.VITE_SYNC_ANON_KEY;
export const syncAvailable = !!(URL_ && ANON);

export const SYNC_LINK_PREFIX = "#sync=";
const META_KEY = "sync:key";
const META_SINCE = "sync:since";
const META_DIRTY = "sync:dirty";
const META_PROTO = "sync:proto";
const META_PREJOIN = "sync:prejoin";
const PROTO = 2;
const PUSH_DELAY = 1500;
const POLL_EVERY = 60_000;
const BATCH = 100;
const PAGE = 500;
/** Matches the server's limit on one encrypted item. */
export const MAX_BLOB = 48 * 1024;
/** Pull a few minutes back from the last row seen, so a slow concurrent push isn't missed. */
const OVERLAP_MS = 5 * 60_000;

/* ---------- keys ---------- */

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O, 1/I/L, U
const KEY_RE = new RegExp(`^[${ALPHABET}]{32}$`);

/** 32 characters from a 30-symbol alphabet: about 157 bits. Shown as 8 groups of 4. */
export function generateSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
/** Accept a key typed with spaces, dashes or lower case. */
export function normaliseKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
/** Only keys this app could have made: 32 characters from its alphabet. */
export const isValidKey = (k: string) => KEY_RE.test(k);
/**
 * The key from whatever was pasted: a sync link (…#sync=KEY), or the key itself with or
 * without dashes. Any other link gives "" so it can't be mistaken for a key.
 */
export function keyFromInput(input: string): string {
  const m = /sync=([A-Za-z0-9-]+)/i.exec(input);
  if (m) return normaliseKey(m[1]);
  if (/:\/\/|^www\./i.test(input.trim())) return "";
  return normaliseKey(input);
}
export const formatKey = (k: string) => k.match(/.{1,4}/g)?.join("-") ?? k;
export const syncLink = (key: string, base = location.origin + location.pathname) => `${base}${SYNC_LINK_PREFIX}${key}`;

/* ---------- merge rule (pure, tested) ---------- */

export interface RemoteState {
  deleted: boolean;
  client_updated_at: string;
}

/** A row as the server returns it. */
interface RemoteRow extends RemoteState {
  item: string;
  blob: string | null;
  server_updated_at: string;
}

/** What's inside an encrypted blob. */
interface Sealed {
  kind: ItemKind;
  id: string;
  data: unknown;
}

export interface DirtyEntry {
  /** Set when the local record was deleted and the deletion hasn't been pushed yet. */
  deletedAt?: string;
}

const t = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Should a record from another device replace what's here?
 * Yes when we have nothing (and it isn't a deletion), or when it's strictly newer than our copy
 * or than our unpushed deletion.
 */
export function shouldApply(local: { updatedAt?: string } | undefined, dirty: DirtyEntry | undefined, remote: RemoteState): boolean {
  const localTime = local ? t(local.updatedAt) : dirty?.deletedAt ? t(dirty.deletedAt) : null;
  if (localTime === null) return !remote.deleted;
  return t(remote.client_updated_at) > localTime;
}

/* ---------- transport ---------- */

export class SyncError extends Error {}

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
      method: "POST",
      // Publishable keys (sb_publishable_…) go in the apikey header only; they aren't JWTs.
      headers: { apikey: ANON!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SyncError("offline");
  }
  if (!res.ok) {
    let msg = `Sync server error (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j?.message === "string") msg = j.message.slice(0, 200);
    } catch { /* keep the status message */ }
    throw new SyncError(msg);
  }
  return res.json() as Promise<T>;
}

/* ---------- engine ---------- */

export type SyncStatus =
  | { state: "unavailable" }
  | { state: "off" }
  | { state: "idle" | "syncing"; lastSynced?: string; note?: string }
  | { state: "offline"; lastSynced?: string }
  | { state: "error"; message: string; lastSynced?: string };

type Listener = (s: SyncStatus) => void;

/** What was on this device before it joined another sync space, so joining can be undone. */
export interface Prejoin {
  at: string;
  /** The sync key this device used before, if any. */
  previousKey: string | null;
  backup: Backup;
}

const KINDS: ItemKind[] = ["patch", "rack", "override"];

class SyncEngine {
  private key: string | null = null;
  private keys: VaultKeys | null = null;
  private dirty: Record<string, DirtyEntry> = {};
  private versions = new Map<string, number>();
  /** item id → kind and id, for records this device knows about. */
  private index = new Map<string, { kind: ItemKind; id: string }>();
  private tooLarge = new Set<string>();
  private status: SyncStatus = { state: syncAvailable ? "off" : "unavailable" };
  private listeners = new Set<Listener>();
  private chain: Promise<unknown> = Promise.resolve();
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lastSynced: string | undefined;
  private ready: Promise<void>;
  /** Called after records from another device were written locally. */
  onRemoteChange: () => void = () => {};

  constructor() {
    this.ready = this.init();
  }

  private async init() {
    if (!syncAvailable || typeof indexedDB === "undefined") return;
    onLocalChange((kind, id) => void this.markDirty(kind, id));
    const key = (await storage.getMeta<string>(META_KEY)) ?? null;
    this.dirty = (await storage.getMeta<Record<string, DirtyEntry>>(META_DIRTY)) ?? {};
    if (!key) return;
    if (!isValidKey(key)) return void (await this.disable());
    await this.useKey(key);
    // Upgrading from unencrypted sync (v1): send everything again, encrypted.
    if ((await storage.getMeta<number>(META_PROTO)) !== PROTO) {
      await this.markAllDirty();
      await storage.setMeta(META_SINCE, null);
      await storage.setMeta(META_PROTO, PROTO);
    }
    this.begin();
  }

  private async useKey(key: string) {
    this.key = key;
    this.keys = await deriveVault(key);
    this.index.clear();
  }

  get current() {
    return this.status;
  }
  get enabled() {
    return !!this.key;
  }
  get syncKey() {
    return this.key;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.status);
    return () => void this.listeners.delete(fn);
  }
  private set(s: SyncStatus) {
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  /** Turn sync on with a new key, sending everything on this device. */
  async enable(): Promise<string> {
    const key = generateSyncKey();
    await this.join(key, { snapshot: false });
    return key;
  }

  /**
   * Join an existing sync key. Everything here is merged with what's already there. Unless told
   * not to, keeps a snapshot of this device's data first, so the join can be undone.
   */
  async join(rawKey: string, opts: { snapshot?: boolean } = {}) {
    await this.ready;
    const key = keyFromInput(rawKey);
    if (!isValidKey(key))
      throw new SyncError(
        /:\/\//.test(rawKey) ? "That link doesn't contain a sync key. Use Copy link for another device on a synced device." : "That isn't a complete sync key. Check you copied all of it.",
      );
    if (key === this.key) return;
    if (opts.snapshot !== false) await this.saveSnapshot();
    await this.useKey(key);
    await storage.setMeta(META_KEY, key);
    await storage.setMeta(META_SINCE, null);
    await storage.setMeta(META_PROTO, PROTO);
    this.dirty = {};
    await this.markAllDirty();
    this.begin();
  }

  /** Stop syncing on this device. Data here and on the server is left as it is. */
  async disable() {
    this.key = null;
    this.keys = null;
    this.index.clear();
    clearInterval(this.pollTimer);
    clearTimeout(this.pushTimer);
    this.dirty = {};
    await storage.setMeta(META_KEY, null);
    await storage.setMeta(META_SINCE, null);
    await storage.setMeta(META_DIRTY, {});
    this.set({ state: "off" });
  }

  /** Delete everything stored on the server for this sync space, then stop syncing here. */
  async deleteRemote(): Promise<number> {
    if (!this.keys) return 0;
    await this.chain.catch(() => {});
    const n = await rpc<number>("sync_delete", { p_vault: this.keys.token });
    await this.disable();
    return n;
  }

  /* ----- undoing a join ----- */

  private async saveSnapshot() {
    const [patches, racks, overrides] = await Promise.all([storage.allPatches(), storage.allRacks(), storage.allOverrides()]);
    if (!patches.length && !racks.length && !overrides.length) return storage.setMeta(META_PREJOIN, null);
    const snap: Prejoin = { at: nowIso(), previousKey: this.key, backup: makeBackup(patches, racks, overrides) };
    await storage.setMeta(META_PREJOIN, snap);
  }

  async prejoin(): Promise<Prejoin | null> {
    const p = (await storage.getMeta<Prejoin>(META_PREJOIN)) ?? null;
    // Kept for 30 days.
    if (p && Date.now() - Date.parse(p.at) > 30 * 86_400_000) {
      await storage.setMeta(META_PREJOIN, null);
      return null;
    }
    return p;
  }

  async dismissPrejoin() {
    await storage.setMeta(META_PREJOIN, null);
  }

  /**
   * Leave the sync space this device joined and put back exactly what was here before.
   * If the device was syncing with its own key before, it goes back to that.
   */
  async undoJoin() {
    const p = await this.prejoin();
    if (!p) return;
    await this.disable();
    for (const kind of KINDS) for (const r of await storage.raw.all<{ id: string }>(kind)) await storage.raw.delete(kind, r.id);
    for (const x of p.backup.patches) await storage.raw.put("patch", cleanPatch(x));
    for (const x of p.backup.racks) {
      const r = cleanRack(x);
      if (r) await storage.raw.put("rack", r);
    }
    for (const x of p.backup.moduleOverrides) {
      const o = cleanOverride(x);
      if (o) await storage.raw.put("override", o);
    }
    await storage.setMeta(META_PREJOIN, null);
    this.onRemoteChange();
    if (p.previousKey && isValidKey(p.previousKey)) await this.join(p.previousKey, { snapshot: false });
  }

  /* ----- running ----- */

  syncNow() {
    if (!this.key) return Promise.resolve();
    this.chain = this.chain.then(() => this.run()).catch(() => {});
    return this.chain;
  }

  private begin() {
    this.set({ state: "idle", lastSynced: this.lastSynced });
    void this.syncNow();
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => document.visibilityState === "visible" && void this.syncNow(), POLL_EVERY);
  }

  private async markAllDirty() {
    for (const kind of KINDS) for (const item of await storage.raw.all<{ id: string }>(kind)) this.dirty[`${kind}:${item.id}`] = {};
    await storage.setMeta(META_DIRTY, this.dirty);
  }

  private async markDirty(kind: ItemKind, id: string) {
    await this.ready;
    if (!this.key) return;
    const k = `${kind}:${id}`;
    const exists = await storage.raw.get(kind, id);
    this.dirty[k] = exists ? {} : { deletedAt: nowIso() };
    this.versions.set(k, (this.versions.get(k) ?? 0) + 1);
    this.tooLarge.delete(k);
    await storage.setMeta(META_DIRTY, this.dirty);
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.syncNow(), PUSH_DELAY);
  }

  private async itemFor(kind: ItemKind, id: string) {
    const item = await itemId(this.keys!, kind, id);
    this.index.set(item, { kind, id });
    return item;
  }

  /** Map every local record to its item id, so deletions from other devices can be found. */
  private async buildIndex() {
    for (const kind of KINDS) for (const r of await storage.raw.all<{ id: string }>(kind)) await this.itemFor(kind, r.id);
  }

  private async run() {
    if (!this.key || !this.keys) return;
    this.set({ state: "syncing", lastSynced: this.lastSynced });
    try {
      await this.push();
      await this.pull();
      this.lastSynced = nowIso();
      const n = this.tooLarge.size;
      this.set({
        state: "idle",
        lastSynced: this.lastSynced,
        note: n ? `${n} item${n === 1 ? " is" : "s are"} too large to sync. Shorten long notes to send ${n === 1 ? "it" : "them"}.` : undefined,
      });
    } catch (e) {
      if (e instanceof SyncError && e.message === "offline") this.set({ state: "offline", lastSynced: this.lastSynced });
      else this.set({ state: "error", message: e instanceof Error ? e.message : "Sync failed", lastSynced: this.lastSynced });
      throw e;
    }
  }

  private async push() {
    const keys = Object.keys(this.dirty).filter((k) => !this.tooLarge.has(k));
    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      const sent = new Map(slice.map((k) => [k, this.versions.get(k) ?? 0]));
      const items: { item: string; blob?: string; deleted: boolean; updatedAt: string }[] = [];
      for (const k of slice) {
        const [kind, ...rest] = k.split(":") as [ItemKind, ...string[]];
        const id = rest.join(":");
        if (!KINDS.includes(kind)) continue;
        const item = await this.itemFor(kind, id);
        const rec = await storage.raw.get<{ id: string; updatedAt?: string }>(kind, id);
        if (rec) {
          const updatedAt = clampTime(rec.updatedAt);
          const blob = await seal(this.keys!, item, { kind, id, data: rec } satisfies Sealed);
          if (blob.length > MAX_BLOB) {
            this.tooLarge.add(k);
            sent.delete(k);
            continue;
          }
          items.push({ item, blob, deleted: false, updatedAt });
        } else items.push({ item, deleted: true, updatedAt: clampTime(this.dirty[k]?.deletedAt) });
      }
      if (items.length) await rpc("sync_push", { p_vault: this.keys!.token, p_items: items });
      for (const [k, v] of sent) if ((this.versions.get(k) ?? 0) === v) delete this.dirty[k];
      await storage.setMeta(META_DIRTY, this.dirty);
    }
  }

  private async pull() {
    let since = (await storage.getMeta<string>(META_SINCE)) ?? null;
    let changed = false;
    let indexed = false;
    for (let page = 0; page < 100; page++) {
      // Only the first page reaches back; later pages continue exactly where the last one ended.
      const from = since && page === 0 ? new Date(Date.parse(since) - OVERLAP_MS).toISOString() : since;
      const rows = await rpc<RemoteRow[]>("sync_pull", { p_vault: this.keys!.token, p_since: from });
      for (const r of rows) {
        let target: { kind: ItemKind; id: string } | undefined;
        let clean: { id: string; updatedAt?: string } | null = null;
        if (r.deleted) {
          if (!indexed) (await this.buildIndex(), (indexed = true));
          target = this.index.get(r.item);
          if (!target) continue; // a deletion of something this device never had
        } else {
          if (!r.blob) continue;
          const sealed = (await open(this.keys!, r.item, r.blob)) as Sealed | null;
          if (!sealed || !KINDS.includes(sealed.kind) || typeof sealed.id !== "string") continue;
          clean = sealed.kind === "patch" ? cleanPatch(sealed.data) : sealed.kind === "rack" ? cleanRack(sealed.data) : cleanOverride(sealed.data);
          if (!clean || clean.id !== sealed.id) continue;
          target = { kind: sealed.kind, id: sealed.id };
          this.index.set(r.item, target);
        }
        const k = `${target.kind}:${target.id}`;
        const local = await storage.raw.get<{ updatedAt?: string }>(target.kind, target.id);
        if (!shouldApply(local, this.dirty[k], r)) continue;
        if (r.deleted) await storage.raw.delete(target.kind, target.id);
        else {
          clean!.updatedAt = clampTime(clean!.updatedAt ?? r.client_updated_at);
          await storage.raw.put(target.kind, clean!);
        }
        delete this.dirty[k];
        changed = true;
      }
      const last = rows[rows.length - 1]?.server_updated_at;
      // Never move the cursor backwards (the overlap can return only older rows).
      const advanced = !!last && (!since || t(last) > t(since));
      if (advanced) since = last;
      if (rows.length < PAGE || !advanced) break;
    }
    await storage.setMeta(META_SINCE, since);
    await storage.setMeta(META_DIRTY, this.dirty);
    if (changed) this.onRemoteChange();
  }
}

export const sync = new SyncEngine();

if (typeof window !== "undefined" && syncAvailable) {
  const kick = () => sync.enabled && void sync.syncNow();
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && kick());
}
