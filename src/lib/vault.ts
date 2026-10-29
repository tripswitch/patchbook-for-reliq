/**
 * End-to-end encryption for sync, using the browser's Web Crypto API.
 *
 * Everything is derived from the sync key, which never leaves the device:
 *   token  identifies the sync space to the server (the server stores only its SHA-256 hash)
 *   enc    AES-GCM-256 key that encrypts each record
 *   mac    HMAC-SHA-256 key that turns "kind:id" into an opaque item id
 * All three come from HKDF-SHA-256 with separate labels, so knowing the token tells the server
 * nothing about the encryption key.
 */

export interface VaultKeys {
  /** 64 hex characters, sent to the server. */
  token: string;
  enc: CryptoKey;
  mac: CryptoKey;
}

const te = new TextEncoder();
const td = new TextDecoder();
const SALT = te.encode("patchbook-for-reliq/sync");
const info = (label: string) => te.encode(`patchbook-for-reliq/${label}/v2`);

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function deriveVault(syncKey: string): Promise<VaultKeys> {
  const subtle = crypto.subtle;
  const ikm = await subtle.importKey("raw", te.encode(syncKey), "HKDF", false, ["deriveBits", "deriveKey"]);
  const token = hex(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: info("vault") }, ikm, 256));
  const enc = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: info("enc") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const mac = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: info("item") },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return { token, enc, mac };
}

/** Opaque, stable id for a record: the server can't tell patches from racks, or read ids. */
export async function itemId(keys: VaultKeys, kind: string, id: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", keys.mac, te.encode(`${kind}:${id}`)));
}

/**
 * Plaintext is padded with trailing spaces (which JSON.parse ignores) to at least 1 KB, then to
 * the next 512 bytes, so the exact size of a record doesn't show through its ciphertext.
 */
export function padded(json: string): Uint8Array {
  const bytes = te.encode(json);
  const size = Math.max(1024, Math.ceil(bytes.length / 512) * 512);
  const out = new Uint8Array(size).fill(0x20);
  out.set(bytes);
  return out;
}

/**
 * Encrypt a value. The item id is bound in as associated data, so blobs can't be swapped between
 * items. Pass pad: false for small records whose size doesn't matter (deletions).
 */
export async function seal(keys: VaultKeys, item: string, value: unknown, opts: { pad?: boolean } = {}): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const json = JSON.stringify(value);
  const plain = opts.pad === false ? te.encode(json) : padded(json);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(item) }, keys.enc, plain as Uint8Array<ArrayBuffer>),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64(out);
}

/** Decrypt a blob, or null if it isn't ours or has been tampered with. */
export async function open(keys: VaultKeys, item: string, blob: string): Promise<unknown | null> {
  try {
    const bytes = fromBase64(blob);
    if (bytes.length < 13) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: te.encode(item) },
      keys.enc,
      bytes.subarray(12),
    );
    return JSON.parse(td.decode(pt));
  } catch {
    return null;
  }
}
