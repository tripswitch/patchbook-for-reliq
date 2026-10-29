import type { ModuleOverride, Patch, Rack } from "./types";

/**
 * Minimal IndexedDB store: everything lives in the user's browser.
 * Stores: patches, racks, overrides (keyed by id) and meta (key/value).
 */
const DB_NAME = "patchbook-for-reliq";
const DB_VERSION = 1;
type StoreName = "patches" | "racks" | "overrides" | "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ["patches", "racks", "overrides"] as const)
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Close other Patchbook tabs to finish updating the database."));
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        let result: T;
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

const all = <T,>(store: StoreName) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
const get = <T,>(store: StoreName, id: string) => tx<T | undefined>(store, "readonly", (s) => s.get(id) as IDBRequest<T | undefined>);
const put = <T,>(store: StoreName, value: T) => tx(store, "readwrite", (s) => void s.put(value));
const del = (store: StoreName, id: string) => tx(store, "readwrite", (s) => void s.delete(id));

/** The three kinds of record that sync between devices. */
export type ItemKind = "patch" | "rack" | "override";
const STORE_OF: Record<ItemKind, StoreName> = { patch: "patches", rack: "racks", override: "overrides" };

/**
 * Called after every local change so sync can queue it. Changes applied from another
 * device go through `storage.raw` instead, so they aren't sent straight back.
 */
let changeHook: ((kind: ItemKind, id: string) => void) | null = null;
export function onLocalChange(fn: ((kind: ItemKind, id: string) => void) | null) {
  changeHook = fn;
}
async function tracked(kind: ItemKind, id: string, op: Promise<unknown>) {
  await op;
  changeHook?.(kind, id);
}

export const storage = {
  allPatches: () => all<Patch>("patches"),
  putPatch: (p: Patch) => tracked("patch", p.id, put("patches", p)),
  deletePatch: (id: string) => tracked("patch", id, del("patches", id)),

  allRacks: () => all<Rack>("racks"),
  putRack: (r: Rack) => tracked("rack", r.id, put("racks", r)),
  deleteRack: (id: string) => tracked("rack", id, del("racks", id)),

  allOverrides: () => all<ModuleOverride>("overrides"),
  putOverride: (o: ModuleOverride) => tracked("override", o.id, put("overrides", o)),
  deleteOverride: (id: string) => tracked("override", id, del("overrides", id)),

  /** Untracked access for the sync engine. */
  raw: {
    get: <T,>(kind: ItemKind, id: string) => get<T>(STORE_OF[kind], id),
    all: <T,>(kind: ItemKind) => all<T>(STORE_OF[kind]),
    put: (kind: ItemKind, value: { id: string }) => put(STORE_OF[kind], value),
    delete: (kind: ItemKind, id: string) => del(STORE_OF[kind], id),
  },

  getMeta: <T,>(key: string) => tx<T | undefined>("meta", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  setMeta: (key: string, value: unknown) => tx("meta", "readwrite", (s) => void s.put(value, key)),

  /** Ask the browser not to evict our data under storage pressure. */
  async persist(): Promise<boolean> {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  },
};

/** Tell other open tabs that data changed, so they reload it. */
// Created on first use, so importing this module doesn't hold a channel open (e.g. in tests).
let ch: BroadcastChannel | null | undefined;
const getChannel = () => (ch === undefined ? (ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(DB_NAME) : null) : ch);
export const sync = {
  announce: () => getChannel()?.postMessage("changed"),
  onChange(fn: () => void) {
    const channel = getChannel();
    if (!channel) return () => {};
    const h = () => fn();
    channel.addEventListener("message", h);
    return () => channel.removeEventListener("message", h);
  },
};
