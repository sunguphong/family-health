/**
 * 기기 안에서만 이뤄지는 암호화. 데이터 비밀번호 → PBKDF2로 AES-GCM 키를 만들고,
 * 서버에는 암호문만 보낸다. 비밀번호와 키는 서버로 가지 않는다.
 */
const ITERATIONS = 310_000;
const VERIFY_TEXT = 'family-health-checkup:v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toB64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function newSalt(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64) as Uint8Array<ArrayBuffer>, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // 키를 꺼낼 수 없게 해서 기기에 기억해 두어도 원문 키가 노출되지 않게 한다
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12)));
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  return toB64(await encryptBytes(key, enc.encode(JSON.stringify(value))));
}

export async function decryptJson<T>(key: CryptoKey, b64: string): Promise<T> {
  return JSON.parse(dec.decode(await decryptBytes(key, fromB64(b64)))) as T;
}

export const makeVerifier = (key: CryptoKey) => encryptJson(key, VERIFY_TEXT);

export async function checkVerifier(key: CryptoKey, verifier: string): Promise<boolean> {
  try {
    return (await decryptJson<string>(key, verifier)) === VERIFY_TEXT;
  } catch {
    return false;
  }
}
