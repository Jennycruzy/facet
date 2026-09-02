/**
 * The encrypted half of a facet record.
 *
 * A facet's routing metadata — which wallet opened it, for which app, at which nonce, holding
 * what — is exactly the wallet-to-identities mapping the product exists to avoid publishing. It
 * has to persist for a facet to be usable across visits, and it must not persist in the clear.
 *
 * So {@link FacetRecord.recovery.encryptedMetadata} is produced here and nowhere else: AES-GCM
 * under a key derived from a secret the *user's wallet* holds, never from anything Facet stores.
 * Whatever holds the ciphertext — this browser's localStorage today, a hosted backup later —
 * learns nothing but the record's existence and size.
 *
 * The key never leaves memory. It is derived through HKDF from a wallet signature, so it is
 * reproducible on a later visit from the same wallet and reproducible nowhere else. Facet cannot
 * decrypt a user's records, and that is a property of the construction rather than a policy.
 */

const SUBTLE = () => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "WebCrypto SubtleCrypto is unavailable; recovery records cannot be sealed or opened here.",
    );
  }
  return subtle;
};

/** Domain separation, so the recovery key can never collide with the pool viewing key. */
export const RECOVERY_KEY_LABEL = "facet-recovery-record:v1";

/** Versioned envelope prefix; a future scheme change stays distinguishable from a corrupt value. */
export const RECOVERY_RECORD_VERSION = "v1";

const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = typeof globalThis.atob === "function"
    ? globalThis.atob(value)
    : Buffer.from(value, "base64").toString("binary");
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Derive the record key from a wallet-held secret.
 *
 * `secret` is any value only the wallet can reproduce — a `personal_sign` result, a Starknet
 * account signature, a passphrase. It is used as HKDF input keying material and is never stored,
 * logged, or returned. `salt` scopes the key: pass the wallet address so two wallets on one
 * device derive different keys from the same phrase.
 *
 * The returned key is non-extractable, so it cannot be read back out of the browser even by the
 * page that derived it.
 */
export async function deriveRecoveryKey(secret: string, salt = ""): Promise<CryptoKey> {
  const material = String(secret ?? "");
  if (!material.trim()) throw new TypeError("A non-empty wallet secret is required.");
  const subtle = SUBTLE();
  const base = await subtle.importKey("raw", encoder.encode(material), "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(String(salt ?? "").toLowerCase()),
      info: encoder.encode(RECOVERY_KEY_LABEL),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a facet's recovery metadata.
 *
 * A fresh random IV is generated per call, so sealing the same record twice yields different
 * ciphertext and an observer cannot tell that a record was rewritten rather than replaced.
 */
export async function sealRecoveryRecord(key: CryptoKey, value: unknown): Promise<string> {
  const subtle = SUBTLE();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encoder.encode(JSON.stringify(value ?? null));
  const sealed = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return [RECOVERY_RECORD_VERSION, toBase64(iv), toBase64(new Uint8Array(sealed))].join(".");
}

/**
 * Decrypt a sealed record.
 *
 * AES-GCM authenticates as well as encrypts, so a tampered or truncated envelope fails here
 * rather than decoding into a plausible-looking record.
 */
export async function openRecoveryRecord<T = unknown>(key: CryptoKey, sealed: string): Promise<T> {
  const parts = String(sealed ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== RECOVERY_RECORD_VERSION) {
    throw new TypeError("Malformed recovery record envelope.");
  }
  const subtle = SUBTLE();
  const iv = fromBase64(parts[1]!);
  const opened = await subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    fromBase64(parts[2]!),
  );
  return JSON.parse(decoder.decode(new Uint8Array(opened))) as T;
}

/** True when a stored value looks like this module's envelope rather than plaintext. */
export function isSealedRecoveryRecord(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${RECOVERY_RECORD_VERSION}.`)
    && value.split(".").length === 3;
}

/**
 * Sealing one field is not sealing a record.
 *
 * A `FacetRecord` carries `wallet`, `app`, `strategy`, `address` and a `key` built from the first
 * three. Persisting a map of those with only `recovery.encryptedMetadata` sealed leaves the
 * wallet-to-application mapping in the clear — twice, because it is also the storage key — which
 * is precisely the mapping the product exists not to publish. Encrypting the leaf while the index
 * stays readable protects nothing that matters.
 *
 * These two functions persist the whole record set as a single opaque envelope under a fixed
 * namespace. What lands in storage is one AES-GCM blob: no wallet, no app id, no address, and no
 * per-record key to count or correlate. The number of facets is not even observable, only the
 * approximate total size.
 */
export const SEALED_FACETS_KEY = "facet-records-sealed-v1";

export interface SealedRecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Seal an entire record set. Anything already in `namespace` is replaced. */
export async function saveSealedFacets<T>(
  storage: SealedRecordStorage,
  key: CryptoKey,
  records: readonly T[],
  namespace: string = SEALED_FACETS_KEY,
): Promise<void> {
  const sealed = await sealRecoveryRecord(key, records);
  try { storage.setItem(namespace, sealed); }
  catch { /* private mode or quota: records are a cache, never the authority */ }
}

/**
 * Open a sealed record set.
 *
 * An absent namespace yields an empty list — a first visit, not an error. A namespace that will
 * not open is *not* silently discarded: the wrong wallet, or a corrupted value, must be
 * distinguishable from having no facets, or the caller would happily overwrite records it simply
 * could not read.
 */
export async function loadSealedFacets<T>(
  storage: SealedRecordStorage,
  key: CryptoKey,
  namespace: string = SEALED_FACETS_KEY,
): Promise<T[]> {
  let sealed: string | null = null;
  try { sealed = storage.getItem(namespace); } catch { return []; }
  if (!sealed) return [];
  const records = await openRecoveryRecord<T[]>(key, sealed);
  return Array.isArray(records) ? records : [];
}
