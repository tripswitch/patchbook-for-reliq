import { BACKUP_FORMAT, SCHEMA_VERSION } from "./types";
import type { ModuleOverride, Patch, SharePayload } from "./types";
import { parseSharePayload, ImportError } from "./backup";

/**
 * Share links carry the whole patch in the URL fragment (#share=...), compressed with
 * the browser's built-in deflate. Fragments never reach the server, so nothing is uploaded.
 */
export const SHARE_PREFIX = "#share=";
/** A real patch compresses to a few KB; anything far bigger isn't one of ours. */
export const MAX_SHARE_TOKEN = 64 * 1024;
const MAX_SHARE_JSON = 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeShare(patch: Patch, customModules: ModuleOverride[]): Promise<string> {
  const payload: SharePayload = { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, kind: "patch", patch, modules: customModules };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

/** Decompress, giving up once the output passes `limit` bytes (so a crafted link can't eat memory). */
async function inflateCapped(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ImportError("That share link is too large to be a Patchbook patch.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.length));
  return out;
}

export async function decodeShare(token: string): Promise<SharePayload> {
  if (token.length > MAX_SHARE_TOKEN) throw new ImportError("That share link is too large to be a Patchbook patch.");
  let text: string;
  try {
    text = new TextDecoder().decode(await inflateCapped(fromBase64Url(token), MAX_SHARE_JSON));
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("That share link is damaged or incomplete. Ask for it to be copied again.");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("That share link is damaged or incomplete. Ask for it to be copied again.");
  }
  return parseSharePayload(data);
}

export function shareUrl(token: string, base = location.origin + location.pathname): string {
  return `${base}${SHARE_PREFIX}${token}`;
}
