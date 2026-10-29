import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backup, BreakoutSettings, JackData, JackId, ModuleDef, ModuleOverride, Patch, Rack, SharePayload, Track } from "./lib/types";
import { storage, sync as tabs } from "./lib/storage";
import { sync as deviceSync } from "./lib/sync";
import { buildLibrary, listKey, type Library } from "./lib/library";
import { clone, newId, nowIso } from "./lib/util";
import baseLibrary from "./generated/library.json";
import { JACKS } from "./lib/panel";

// Validated by scripts/library.ts at build time.
const BASE = baseLibrary as unknown as ModuleDef[];
const SAVE_DELAY = 300;

export interface PatchbookState {
  ready: boolean;
  patches: Patch[];
  racks: Rack[];
  overrides: ModuleOverride[];
  library: Library;
  current: Patch | null;
  currentId: string | null;
  saveState: "idle" | "saving" | "saved" | "error";
}

export function usePatchbook() {
  const [ready, setReady] = useState(false);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [overrides, setOverrides] = useState<ModuleOverride[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<PatchbookState["saveState"]>("idle");

  const patchesRef = useRef(patches);
  patchesRef.current = patches;
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const loadAll = useCallback(async () => {
    const [p, r, o, cur] = await Promise.all([
      storage.allPatches(),
      storage.allRacks(),
      storage.allOverrides(),
      storage.getMeta<string>("currentId"),
    ]);
    // Keep in-memory copies of patches with edits that haven't been written yet.
    setPatches((prev) => {
      const out = p.map((x) => (pending.current.has(x.id) ? prev.find((y) => y.id === x.id) ?? x : x));
      for (const y of prev) if (pending.current.has(y.id) && !out.some((x) => x.id === y.id)) out.push(y);
      return out;
    });
    setRacks(r);
    setOverrides(o);
    setCurrentId((prev) => {
      const want = prev ?? cur ?? null;
      if (want && p.some((x) => x.id === want)) return want;
      return [...p].sort(newestFirst)[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    loadAll().then(() => setReady(true));
    void storage.persist();
    // Changes from another device: reload here and tell other open tabs.
    deviceSync.onRemoteChange = () => {
      void loadAll();
      tabs.announce();
    };
    const off = tabs.onChange(() => void loadAll());
    return () => {
      off();
      deviceSync.onRemoteChange = () => {};
    };
  }, [loadAll]);

  useEffect(() => {
    if (ready) void storage.setMeta("currentId", currentId);
  }, [currentId, ready]);

  /* Flush pending writes when the tab is hidden or closed. */
  useEffect(() => {
    const flush = () => {
      for (const [id, t] of pending.current) {
        clearTimeout(t);
        const p = patchesRef.current.find((x) => x.id === id);
        if (p) void storage.putPatch(p);
      }
      pending.current.clear();
    };
    const onVis = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const scheduleSave = useCallback((id: string) => {
    setSaveState("saving");
    const prev = pending.current.get(id);
    if (prev) clearTimeout(prev);
    pending.current.set(
      id,
      setTimeout(async () => {
        pending.current.delete(id);
        const p = patchesRef.current.find((x) => x.id === id);
        if (!p) return;
        try {
          await storage.putPatch(p);
          setSaveState("saved");
          tabs.announce();
        } catch {
          setSaveState("error");
        }
      }, SAVE_DELAY),
    );
  }, []);

  /** Apply a change to one patch and schedule its save. */
  const editPatch = useCallback(
    (id: string, fn: (p: Patch) => void) => {
      setPatches((ps) =>
        ps.map((p) => {
          if (p.id !== id) return p;
          const next = clone(p);
          fn(next);
          next.updatedAt = nowIso();
          return next;
        }),
      );
      scheduleSave(id);
    },
    [scheduleSave],
  );

  const library = useMemo(() => buildLibrary(BASE, overrides), [overrides]);
  const current = patches.find((p) => p.id === currentId) ?? null;

  const actions = useMemo(() => {
    const putNew = async (p: Patch) => {
      setPatches((ps) => [...ps, p]);
      setCurrentId(p.id);
      await storage.putPatch(p);
      tabs.announce();
      return p.id;
    };

    const saveOverride = async (o: ModuleOverride) => {
      setOverrides((os) => (os.some((x) => x.id === o.id) ? os.map((x) => (x.id === o.id ? o : x)) : [...os, o]));
      await storage.putOverride(o);
      tabs.announce();
    };

    return {
      selectPatch: (id: string) => setCurrentId(id),

      createPatch: (name: string, from?: Patch) =>
        putNew({
          id: newId(),
          name,
          notes: from?.notes ?? "",
          updatedAt: nowIso(),
          jacks: from ? clone(from.jacks) : {},
          tracks: from ? clone(from.tracks) : {},
          brk: from ? clone(from.brk) : {},
        }),

      renamePatch: (id: string, name: string) => editPatch(id, (p) => void (p.name = name)),
      setNotes: (id: string, notes: string) => editPatch(id, (p) => void (p.notes = notes)),

      async deletePatch(id: string) {
        const t = pending.current.get(id);
        if (t) clearTimeout(t), pending.current.delete(id);
        setPatches((ps) => ps.filter((p) => p.id !== id));
        setCurrentId((cur) => (cur === id ? [...patchesRef.current].filter((p) => p.id !== id).sort(newestFirst)[0]?.id ?? null : cur));
        await storage.deletePatch(id);
        tabs.announce();
      },

      setJackField(id: string, jack: JackId, field: keyof JackData, value: string) {
        editPatch(id, (p) => {
          const d: Record<string, string> = { ...(p.jacks[jack] ?? {}) };
          if (value) d[field] = value;
          else delete d[field];
          if (Object.keys(d).length) p.jacks[jack] = d as JackData;
          else delete p.jacks[jack];
        });
      },

      /** Change a jack's module; clear the jack name if it doesn't exist on the new module. */
      setJackModule(id: string, jack: JackId, mod: string) {
        editPatch(id, (p) => {
          const d: JackData = { ...(p.jacks[jack] ?? {}) };
          const prevMod = d.mod;
          if (mod) d.mod = mod;
          else delete d.mod;
          if (prevMod && prevMod !== mod && d.to) {
            const list = mod ? library.get(mod)?.[listKey(JACKS[jack].dir)] : undefined;
            if (!list?.includes(d.to)) delete d.to;
          }
          if (Object.keys(d).length) p.jacks[jack] = d;
          else delete p.jacks[jack];
        });
      },

      clearJack: (id: string, jack: JackId) => editPatch(id, (p) => void delete p.jacks[jack]),

      setTrack(id: string, n: number, field: keyof Track, value: string | boolean) {
        editPatch(id, (p) => {
          const t: Record<string, unknown> = { ...(p.tracks[n] ?? {}) };
          if (value) t[field] = value;
          else delete t[field];
          if (Object.keys(t).length) p.tracks[n] = t as Track;
          else delete p.tracks[n];
        });
      },
      clearTrack: (id: string, n: number) => editPatch(id, (p) => void delete p.tracks[n]),

      /** Set the module on any of the track's three jacks that don't have one, guessing pitch and gate jacks. */
      fillTrackJacks(id: string, n: number, mod: string, guesses: Partial<Record<JackId, string>>): number {
        let count = 0;
        const p0 = patchesRef.current.find((p) => p.id === id);
        for (const jack of [`cv${n}a`, `cv${n}b`, `g${n}`]) if (!p0?.jacks[jack]?.mod) count++;
        editPatch(id, (p) => {
          for (const jack of [`cv${n}a`, `cv${n}b`, `g${n}`]) {
            const d: JackData = { ...(p.jacks[jack] ?? {}) };
            if (d.mod) continue;
            d.mod = mod;
            if (!d.to && guesses[jack]) d.to = guesses[jack];
            p.jacks[jack] = d;
          }
        });
        return count;
      },

      setBreakout(id: string, field: keyof BreakoutSettings, value: string) {
        editPatch(id, (p) => {
          const b: Record<string, string> = { ...p.brk };
          if (value) b[field] = value;
          else delete b[field];
          p.brk = b as BreakoutSettings;
        });
      },

      async saveRack(rack: Rack) {
        const r = { ...rack, updatedAt: nowIso() };
        setRacks((rs) => (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [...rs, r]));
        await storage.putRack(r);
        tabs.announce();
      },
      async deleteRack(id: string) {
        setRacks((rs) => rs.filter((r) => r.id !== id));
        await storage.deleteRack(id);
        tabs.announce();
      },

      saveOverride,
      async resetOverride(id: string) {
        setOverrides((os) => os.filter((o) => o.id !== id));
        await storage.deleteOverride(id);
        tabs.announce();
      },

      /** Add a typed jack name to a module's list (inputs or outputs) if it's new. Returns true if added. */
      async learnJack(mod: string, key: "inputs" | "outputs", name: string): Promise<boolean> {
        const m = library.get(mod);
        if (!m || m[key].includes(name)) return false;
        const existing = overrides.find((o) => o.id === mod);
        const o: ModuleOverride = {
          ...(existing ?? { id: mod }),
          inputs: key === "inputs" ? [...m.inputs, name] : existing?.inputs ?? (m.custom ? m.inputs : undefined),
          outputs: key === "outputs" ? [...m.outputs, name] : existing?.outputs ?? (m.custom ? m.outputs : undefined),
          updatedAt: nowIso(),
        };
        await saveOverride(o);
        return true;
      },

      /** Merge a backup in. Patches, racks and module edits with the same id are replaced by the file's copy. */
      async importBackup(b: Backup) {
        for (const p of b.patches) await storage.putPatch(p);
        for (const r of b.racks) await storage.putRack(r);
        for (const o of b.moduleOverrides) await storage.putOverride(o);
        await loadAll();
        if (b.patches[0]) setCurrentId([...b.patches].sort(newestFirst)[0].id);
        tabs.announce();
      },

      /** Add a shared patch as a new patch, plus any custom modules it needs that aren't here yet. */
      async importShared(s: SharePayload): Promise<string> {
        for (const m of s.modules) if (!library.has(m.id)) await storage.putOverride(m);
        const p: Patch = { ...clone(s.patch), id: newId(), updatedAt: nowIso() };
        await storage.putPatch(p);
        await loadAll();
        setCurrentId(p.id);
        tabs.announce();
        return p.id;
      },
    };
  }, [editPatch, library, overrides, loadAll]);

  const state: PatchbookState = { ready, patches, racks, overrides, library, current, currentId, saveState };
  return { state, actions };
}

export type Actions = ReturnType<typeof usePatchbook>["actions"];

export const newestFirst = (a: Patch, b: Patch) => (b.updatedAt || "").localeCompare(a.updatedAt || "");
