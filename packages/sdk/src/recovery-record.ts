/**
 * The encrypted half of a facet record.
 *
 * A facet's routing metadata — which wallet opened it, for which app, at which nonce, holding
 * what — is exactly the wallet-to-identities mapping the product exists to avoid publishing. It
 * has to persist for a facet to be usable across visits, and it must not persist in the clear.
 *
 * The whole record set is produced here and nowhere else: AES-GCM under a key derived from a
 * secret the *user's wallet* holds, never from anything Facet stores. Whatever holds the ciphertext
 * — this browser's localStorage today, a hosted backup later — learns nothing but its existence and
 * size.
 *
 * The key never leaves memory. It must be derived through a verified wallet-held or user-held
 * secret; an EOA-shaped `personal_sign` result must not be assumed to work for a Starknet
 * smart-contract wallet. Facet cannot decrypt a user's records, and that is a property of the
 * construction rather than a policy.
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
 * `secret` must be a verified, high-entropy value only the user can reproduce — for example a
 * Starknet-native account result or a passkey-derived secret. An EOA-shaped `personal_sign` result
 * must not be assumed to work with a Starknet smart-contract wallet. For a human recovery
 * passphrase use `derivePassphraseRecoveryKey`, which applies a salted, slow KDF. This secret is
 * used as HKDF input keying material and is never stored,
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
 * three. Persisting a map of those with only one field sealed leaves the wallet-to-application
 * mapping in the clear — twice, because it is also the storage key — which is precisely the mapping
 * the product exists not to publish. Encrypting a leaf while the index stays readable protects
 * nothing that matters.
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
): Promise<boolean> {
  const sealed = await sealRecoveryRecord(key, records);
  try {
    storage.setItem(namespace, sealed);
    return true;
  } catch {
    return false;
  }
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
  try { sealed = storage.getItem(namespace); }
  catch (error) {
    throw new Error(
      `Unable to read sealed facet records: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!sealed) return [];
  const records = await openRecoveryRecord<T[]>(key, sealed);
  if (!Array.isArray(records)) throw new TypeError("Malformed sealed facet record set.");
  return records;
}

/**
 * A passphrase-backed vault for callers that do not yet have a verified wallet-native secret.
 *
 * Wallet signatures are not substituted here: a Starknet smart-contract wallet does not promise
 * an EOA-shaped personal_sign result. PBKDF2 makes the explicit user passphrase path expensive to
 * brute-force, and a fresh random salt is stored only as part of the opaque envelope header. The
 * salt is not identifying; the records and the passphrase-derived AES key never leave memory.
 */
export const RECOVERY_PASSPHRASE_ITERATIONS = 310_000;
/** Minimum passphrase length accepted by the explicit user-unlock path. */
export const RECOVERY_PASSPHRASE_MIN_LENGTH = 16;
const PASSPHRASE_ENVELOPE_VERSION = "p1";
const PASSPHRASE_SALT_BYTES = 16;

function passphraseSalt(salt: Uint8Array): Uint8Array<ArrayBuffer> {
  const domain = encoder.encode(`${RECOVERY_KEY_LABEL}:passphrase:`);
  const combined = new Uint8Array(new ArrayBuffer(domain.length + salt.length));
  combined.set(domain, 0);
  combined.set(salt, domain.length);
  return combined;
}

function requirePassphrase(passphrase: string): string {
  const material = String(passphrase ?? "");
  if (material.trim().length < RECOVERY_PASSPHRASE_MIN_LENGTH) {
    throw new TypeError(
      `A recovery passphrase of at least ${RECOVERY_PASSPHRASE_MIN_LENGTH} characters is required.`,
    );
  }
  return material;
}

function requirePassphraseSalt(salt: Uint8Array): Uint8Array {
  if (!(salt instanceof Uint8Array) || salt.length < PASSPHRASE_SALT_BYTES) {
    throw new TypeError("A random recovery passphrase salt is required.");
  }
  return salt;
}

/** Derive the non-extractable AES key used by the explicit passphrase unlock flow. */
export async function derivePassphraseRecoveryKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = requirePassphrase(passphrase);
  const kdfSalt = passphraseSalt(requirePassphraseSalt(salt));
  const subtle = SUBTLE();
  const base = await subtle.importKey(
    "raw",
    encoder.encode(material),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: kdfSalt,
      iterations: RECOVERY_PASSPHRASE_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function newPassphraseSalt(): Uint8Array<ArrayBuffer> {
  const salt = new Uint8Array(new ArrayBuffer(PASSPHRASE_SALT_BYTES));
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

function parsePassphraseEnvelope(value: string): { salt: Uint8Array<ArrayBuffer>; sealed: string } {
  const parts = String(value ?? "").split(".");
  // p1.<salt>.<record-version>.<iv>.<ciphertext>
  if (parts.length !== 5 || parts[0] !== PASSPHRASE_ENVELOPE_VERSION
    || parts[2] !== RECOVERY_RECORD_VERSION) {
    throw new TypeError("Malformed passphrase recovery envelope.");
  }
  const salt = fromBase64(parts[1]!);
  if (salt.length < PASSPHRASE_SALT_BYTES) {
    throw new TypeError("Malformed passphrase recovery salt.");
  }
  return { salt, sealed: parts.slice(2).join(".") };
}

export interface PassphraseRecoveryVault<T> {
  /** The non-extractable key stays in the caller's memory and is never serializable. */
  key: CryptoKey;
  /** The public KDF salt needed to reseal this vault; it contains no record metadata. */
  salt: Uint8Array<ArrayBuffer>;
  records: T[];
  /** False means this passphrase has prepared a new empty vault but has not written it yet. */
  configured: boolean;
}

/** Unlock an opaque passphrase vault, or prepare an empty one on its first use. */
export async function unlockPassphraseSealedFacets<T>(
  storage: SealedRecordStorage,
  passphrase: string,
  namespace: string = SEALED_FACETS_KEY,
): Promise<PassphraseRecoveryVault<T>> {
  requirePassphrase(passphrase);
  let sealed: string | null = null;
  try { sealed = storage.getItem(namespace); }
  catch (error) {
    throw new Error(
      `Unable to read sealed facet records: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!sealed) {
    const salt = newPassphraseSalt();
    return {
      key: await derivePassphraseRecoveryKey(passphrase, salt),
      salt,
      records: [],
      configured: false,
    };
  }
  const parsed = parsePassphraseEnvelope(sealed);
  const key = await derivePassphraseRecoveryKey(passphrase, parsed.salt);
  const records = await openRecoveryRecord<T[]>(key, parsed.sealed);
  if (!Array.isArray(records)) throw new TypeError("Malformed sealed facet record set.");
  return { key, salt: parsed.salt, records, configured: true };
}

/** Reseal an already unlocked passphrase vault without ever receiving the passphrase again. */
export async function saveUnlockedPassphraseSealedFacets<T>(
  storage: SealedRecordStorage,
  vault: Pick<PassphraseRecoveryVault<unknown>, "key" | "salt">,
  records: readonly T[],
  namespace: string = SEALED_FACETS_KEY,
  canWrite: () => boolean = () => true,
): Promise<boolean> {
  const sealed = await sealRecoveryRecord(vault.key, records);
  const envelope = [
    PASSPHRASE_ENVELOPE_VERSION,
    toBase64(requirePassphraseSalt(vault.salt)),
    sealed,
  ].join(".");
  try {
    // A caller can invalidate an in-flight save when its wallet/account changes. Check immediately
    // before the synchronous storage write so an old account cannot overwrite newer state after an
    // awaited WebCrypto operation.
    if (!canWrite()) return false;
    storage.setItem(namespace, envelope);
    return true;
  } catch {
    return false;
  }
}

/** One-shot passphrase save for callers such as a confirmed route result. */
export async function savePassphraseSealedFacets<T>(
  storage: SealedRecordStorage,
  passphrase: string,
  records: readonly T[],
  namespace: string = SEALED_FACETS_KEY,
): Promise<boolean> {
  const vault = await unlockPassphraseSealedFacets<T>(storage, passphrase, namespace);
  return saveUnlockedPassphraseSealedFacets(storage, vault, records, namespace);
}

/** One-shot passphrase load for a caller that does not need to retain the in-memory key. */
export async function loadPassphraseSealedFacets<T>(
  storage: SealedRecordStorage,
  passphrase: string,
  namespace: string = SEALED_FACETS_KEY,
): Promise<T[]> {
  const vault = await unlockPassphraseSealedFacets<T>(storage, passphrase, namespace);
  return vault.records;
}
