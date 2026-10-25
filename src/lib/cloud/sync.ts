import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Dexie, { type Table } from 'dexie';
import { useSyncExternalStore } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from '../../config';
import { changeListeners, db, isGlobalId, newId, REMOTE, SYNC_TABLES, type SyncKind } from '../db';
import { checkVerifier, decryptBytes, decryptJson, deriveKey, encryptBytes, encryptJson, makeVerifier, newSalt } from './crypto';

/* ------------------------------------------------------------------ */
/* 연결·상태                                                             */
/* ------------------------------------------------------------------ */

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

/** 동기화 보조 정보(마지막 동기화 시각, 이 기기에 기억한 키, 삭제 기록)는 별도 DB에 둔다 */
const meta = new Dexie('family-health-sync') as Dexie & {
  meta: Table<{ key: string; value: unknown }, string>;
  tombs: Table<{ kind: SyncKind; id: string; at: number }, [SyncKind, string]>;
};
meta.version(1).stores({ meta: 'key', tombs: '[kind+id]' });
const getMeta = async <T>(key: string, fallback: T) => ((await meta.meta.get(key))?.value as T) ?? fallback;
const setMeta = (key: string, value: unknown) => meta.meta.put({ key, value });

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncAt?: number;
  message?: string;
}
let status: SyncStatus = { state: cloudEnabled ? 'idle' : 'off' };
const subs = new Set<() => void>();
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  subs.forEach((f) => f());
}
export function useSyncStatus() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => status,
  );
}

let cryptoKey: CryptoKey | null = null;
let userId: string | null = null;

/** 기기에만 남기고 서버로 보내지 않는 설정 */
const LOCAL_ONLY_SETTINGS = new Set(['seeded']);

/* ------------------------------------------------------------------ */
/* 데이터 비밀번호 (종단간 암호화 키)                                      */
/* ------------------------------------------------------------------ */

export async function getVault(): Promise<{ salt: string; verifier: string } | null> {
  const { data, error } = await supabase().from('vault').select('salt, verifier').maybeSingle();
  if (error) throw new Error(`서버 연결 오류: ${error.message}`);
  return data;
}

export async function createVault(passphrase: string, remember: boolean) {
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt);
  const { error } = await supabase().from('vault').insert({ salt, verifier: await makeVerifier(key) });
  if (error) throw new Error(`데이터 비밀번호를 저장하지 못했습니다: ${error.message}`);
  await useKey(key, remember);
}

/** 비밀번호가 맞으면 true */
export async function unlock(passphrase: string, remember: boolean): Promise<boolean> {
  const vault = await getVault();
  if (!vault) throw new Error('데이터 비밀번호가 아직 없습니다.');
  const key = await deriveKey(passphrase, vault.salt);
  if (!(await checkVerifier(key, vault.verifier))) return false;
  await useKey(key, remember);
  return true;
}

async function useKey(key: CryptoKey, remember: boolean) {
  cryptoKey = key;
  // 꺼낼 수 없는(non-extractable) 키 객체 그대로 이 기기에만 저장
  if (remember) await setMeta(`key:${userId}`, key);
  else await meta.meta.delete(`key:${userId}`);
}

/** 이 기기에 기억해 둔 키가 있으면 바로 잠금 해제 */
export async function tryRememberedKey(): Promise<boolean> {
  const key = await getMeta<CryptoKey | null>(`key:${userId}`, null);
  if (!key) return false;
  const vault = await getVault();
  if (!vault || !(await checkVerifier(key, vault.verifier))) return false;
  cryptoKey = key;
  return true;
}

export const isUnlocked = () => !!cryptoKey;

/* ------------------------------------------------------------------ */
/* 로그인                                                              */
/* ------------------------------------------------------------------ */

export function setSessionUser(id: string | null) {
  userId = id;
  if (!id) cryptoKey = null;
}

export async function signOutAndWipe() {
  try {
    if (cryptoKey) await syncNow();
  } catch {
    /* 올리지 못한 변경이 있어도 로그아웃은 진행 */
  }
  await meta.meta.delete(`key:${userId}`);
  await meta.meta.clear();
  await meta.tombs.clear();
  await supabase().auth.signOut();
  // 다른 사람이 쓸 수도 있는 컴퓨터에 기록이 남지 않도록 이 기기의 사본을 지운다
  await db.delete();
  try {
    localStorage.removeItem('activeMemberId');
  } catch {
    /* 무시 */
  }
  location.reload();
}

/* ------------------------------------------------------------------ */
/* 처음 동기화: ID 정리 + 병합                                           */
/* ------------------------------------------------------------------ */

/** 기기마다 겹치는 작은 자동 번호를 전역 ID로 바꾸고, 참조(memberId·examId)도 함께 고친다 */
async function rekeyLocal() {
  await db.transaction('rw', [db.members, db.exams, db.results, db.files, db.settings], async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    const mMap = new Map<number, number>();
    const eMap = new Map<number, number>();
    for (const m of await db.members.toArray()) {
      if (isGlobalId(m.id!)) continue;
      const id = newId();
      mMap.set(m.id!, id);
      await db.members.delete(m.id!);
      await db.members.add({ ...m, id, _m: Date.now() } as never);
    }
    for (const e of await db.exams.toArray()) {
      const memberId = mMap.get(e.memberId) ?? e.memberId;
      if (isGlobalId(e.id!) && memberId === e.memberId) continue;
      const id = isGlobalId(e.id!) ? e.id! : newId();
      if (id !== e.id) eMap.set(e.id!, id);
      await db.exams.delete(e.id!);
      await db.exams.add({ ...e, id, memberId, _m: Date.now() } as never);
    }
    for (const r of await db.results.toArray()) {
      const examId = eMap.get(r.examId) ?? r.examId;
      if (isGlobalId(r.id!) && examId === r.examId) continue;
      await db.results.delete(r.id!);
      await db.results.add({ ...r, id: isGlobalId(r.id!) ? r.id : newId(), examId, _m: Date.now() } as never);
    }
    for (const f of await db.files.toArray()) {
      const examId = eMap.get(f.examId) ?? f.examId;
      if (isGlobalId(f.id!) && examId === f.examId) continue;
      await db.files.delete(f.id!);
      await db.files.add({ ...f, id: isGlobalId(f.id!) ? f.id : newId(), examId, _m: Date.now() } as never);
    }
    for (const [oldId, id] of mMap) {
      const s = await db.settings.get(`advice:${oldId}`);
      if (s) {
        await db.settings.delete(s.key);
        await db.settings.put({ ...s, key: `advice:${id}`, _m: Date.now() } as never);
      }
    }
    try {
      const active = Number(localStorage.getItem('activeMemberId'));
      if (mMap.has(active)) localStorage.setItem('activeMemberId', String(mMap.get(active)));
    } catch {
      /* 무시 */
    }
  });
}

/** 샘플 데이터는 서버에 올리지 않는다 */
async function dropSampleData() {
  await db.transaction('rw', [db.members, db.exams, db.results, db.files], async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    const exams = await db.exams.filter((e) => !!e.isSample).toArray();
    const ids = exams.map((e) => e.id!);
    await db.results.where('examId').anyOf(ids).delete();
    await db.files.where('examId').anyOf(ids).delete();
    await db.exams.bulkDelete(ids);
    // 샘플 구성원에 실제 검진을 올려 둔 경우 그 구성원은 일반 구성원으로 남긴다
    for (const m of await db.members.filter((x) => !!x.isSample).toArray()) {
      const real = await db.exams.where('memberId').equals(m.id!).count();
      if (real) await db.members.put({ ...m, isSample: false, name: m.name.replace(/\s*\(샘플\)$/, '') });
      else await db.members.delete(m.id!);
    }
  });
}

/** 이 기기에 이 계정의 사본이 아직 없어서, 전부 내려받을 때까지 기다려야 하는지 */
export async function needsFullDownload(): Promise<boolean> {
  return (await getMeta<string | null>('userId', null)) !== userId || (await getMeta<string | null>('lastPull', null)) == null;
}

/** 로그인·잠금 해제 직후 한 번. 이 기기의 기존 기록을 서버 기록과 합친다 */
export async function initialSync(progress: (msg: string) => void) {
  const lastUser = await getMeta<string | null>('userId', null);
  if (lastUser && lastUser !== userId) {
    // 다른 계정이 쓰던 기기: 섞이지 않게 비우고 시작
    await db.transaction('rw', SYNC_TABLES.map((k) => db.table(k)), async (tx) => {
      (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
      for (const k of SYNC_TABLES) if (k !== 'items') await db.table(k).clear();
    });
    await meta.meta.clear();
    await meta.tombs.clear();
  }
  if (lastUser !== userId) {
    progress('이 기기의 기록을 정리하는 중…');
    await dropSampleData();
    await rekeyLocal();
    await setMeta('lastPush', 0);
    await setMeta('lastPull', null);
    await setMeta('firstSync', true);
    await setMeta('userId', userId);
  }
  progress('서버와 동기화하는 중…');
  await syncNow();
  await setMeta('firstSync', false);
}

/* ------------------------------------------------------------------ */
/* 올리기 / 받기                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown> & { _m?: number };
const pkOf = (kind: SyncKind, row: Row) => String(kind === 'items' ? row.code : kind === 'settings' ? row.key : row.id);
const pagePath = (fileId: string, i: number) => `${userId}/${fileId}/${i}`;

async function push() {
  const key = cryptoKey!;
  const since = await getMeta<number>('lastPush', 0);
  const startedAt = Date.now() - 1;
  const sb = supabase();

  for (const kind of SYNC_TABLES) {
    const rows = ((await db.table(kind).toArray()) as Row[]).filter((r) => r._m === undefined || r._m > since);
    const out: { user_id: string; kind: string; id: string; data: string; deleted: boolean }[] = [];
    for (const row of rows) {
      if (kind === 'settings' && LOCAL_ONLY_SETTINGS.has(String(row.key))) continue;
      const id = pkOf(kind, row);
      let value: Row = { ...row };
      delete value._m;
      if (kind === 'files') {
        const pages = (row.pages as Blob[]) ?? [];
        let done = 0;
        await pool(pages.map((_, i) => i), 4, async (i) => {
          const body = await encryptBytes(key, new Uint8Array(await pages[i].arrayBuffer()));
          const { error } = await sb.storage.from('pages').upload(pagePath(id, i), new Blob([body as BlobPart]), {
            upsert: true,
            contentType: 'application/octet-stream',
          });
          if (error) throw new Error(`원본 이미지 업로드 실패: ${error.message}`);
          setStatus({ message: `원본 이미지 올리는 중 (${++done}/${pages.length}장)` });
        });
        value = { ...value, pages: undefined, pageCount: pages.length };
      }
      out.push({ user_id: userId!, kind, id, data: await encryptJson(key, value), deleted: false });
    }
    for (let i = 0; i < out.length; i += 200) {
      const { error } = await sb.from('records').upsert(out.slice(i, i + 200), { onConflict: 'user_id,kind,id' });
      if (error) throw new Error(`서버 저장 실패: ${error.message}`);
    }
    // 수정 시각이 없던 기록(동기화 이전 버전에서 만든 것)은 올린 뒤 '맞춰짐'으로 표시해 둔다.
    // 그러지 않으면 계속 '이 기기에서 바뀜'으로 보여 다른 기기의 수정을 덮어쓴다.
    const unstamped = rows.filter((r) => r._m === undefined).map((r) => pkOf(kind, r));
    if (unstamped.length) {
      const table = db.table(kind);
      await applyRemote(table, async () => {
        for (const id of unstamped) {
          await table.update(kind === 'items' || kind === 'settings' ? id : Number(id), { _m: 1 });
        }
      });
    }
  }

  const tombs = await meta.tombs.toArray();
  if (tombs.length) {
    const rows = tombs.map((t) => ({ user_id: userId!, kind: t.kind, id: t.id, data: null, deleted: true }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from('records').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,kind,id' });
      if (error) throw new Error(`서버 삭제 반영 실패: ${error.message}`);
    }
    for (const t of tombs.filter((x) => x.kind === 'files')) {
      const { data } = await sb.storage.from('pages').list(`${userId}/${t.id}`);
      if (data?.length) await sb.storage.from('pages').remove(data.map((o) => `${userId}/${t.id}/${o.name}`));
    }
    await meta.tombs.bulkDelete(tombs.map((t) => [t.kind, t.id] as [SyncKind, string]));
  }
  await setMeta('lastPush', startedAt);
}

/** 동시에 n개씩 처리 (원본 이미지 내려받기 속도용) */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

type RemoteRow = { kind: SyncKind; id: string; data: string | null; deleted: boolean; updated_at: string };

async function pull() {
  const key = cryptoKey!;
  const sb = supabase();
  const lastPush = await getMeta<number>('lastPush', 0);
  const firstSync = await getMeta<boolean>('firstSync', false);
  let cursor = await getMeta<string | null>('lastPull', null);
  let received = 0;

  for (;;) {
    let q = sb.from('records').select('kind, id, data, deleted, updated_at').order('updated_at').limit(500);
    if (cursor) q = q.gt('updated_at', cursor);
    const { data, error } = await q;
    if (error) throw new Error(`서버에서 받기 실패: ${error.message}`);
    if (!data?.length) break;
    const batch = data as RemoteRow[];
    received += batch.length;
    setStatus({ message: `기록 받는 중 (${received}건)` });

    for (const kind of SYNC_TABLES) {
      const rows = batch.filter((r) => r.kind === kind);
      if (!rows.length) continue;
      const table = db.table(kind);
      const pkOfRow = (r: RemoteRow) => (kind === 'items' || kind === 'settings' ? r.id : Number(r.id));
      const locals = (await table.bulkGet(rows.map(pkOfRow))) as (Row | undefined)[];
      const puts: Row[] = [];
      const dels: (string | number)[] = [];
      const files: { row: RemoteRow; value: Row }[] = [];

      await Promise.all(
        rows.map(async (r, idx) => {
          const local = locals[idx];
          // 아직 올리지 않은 이 기기의 변경이 있으면 그쪽을 살린다 (처음 동기화 때는 서버 우선)
          if (!firstSync && local && (local._m === undefined || local._m > lastPush)) return;
          if (r.deleted || !r.data) {
            if (local) dels.push(pkOfRow(r));
            return;
          }
          const value = await decryptJson<Row>(key, r.data);
          value._m = 0;
          if (kind === 'files') files.push({ row: r, value });
          else puts.push(value);
        }),
      );

      // 원본 이미지는 여러 장을 동시에 받는다
      if (files.length) {
        const jobs = files.flatMap(({ row, value }) => {
          const n = Number(value.pageCount ?? 0);
          value.pages = new Array<Blob>(n);
          delete value.pageCount;
          return Array.from({ length: n }, (_, i) => ({ id: row.id, i, value }));
        });
        let done = 0;
        await pool(jobs, 6, async (job) => {
          const { data: blob, error: e2 } = await sb.storage.from('pages').download(pagePath(job.id, job.i));
          if (e2 || !blob) throw new Error(`원본 이미지를 받지 못했습니다: ${e2?.message ?? ''}`);
          const plain = await decryptBytes(key, new Uint8Array(await blob.arrayBuffer()));
          (job.value.pages as Blob[])[job.i] = new Blob([plain as BlobPart], { type: 'image/jpeg' });
          setStatus({ message: `원본 이미지 받는 중 (${++done}/${jobs.length}장)` });
        });
        puts.push(...files.map((f) => f.value));
      }

      if (puts.length || dels.length) {
        await applyRemote(table, async () => {
          if (dels.length) await table.bulkDelete(dels);
          if (puts.length) await table.bulkPut(puts);
        });
      }
    }
    cursor = batch[batch.length - 1].updated_at;
    await setMeta('lastPull', cursor);
    if (batch.length < 500) break;
  }
}

async function applyRemote(table: Table, fn: () => Promise<unknown>) {
  await db.transaction('rw', table, async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    await fn();
  });
}

let running: Promise<void> | null = null;
let again = false;

/** 받기 → 올리기. 동시에 여러 번 불리면 하나로 합친다 */
export function syncNow(): Promise<void> {
  if (!cloudEnabled || !cryptoKey || !userId) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        if (!navigator.onLine) {
          setStatus({ state: 'offline', message: '오프라인 · 연결되면 자동으로 동기화합니다' });
          return;
        }
        setStatus({ state: 'syncing', message: undefined });
        await pull();
        await push();
      } while (again);
      setStatus({ state: 'idle', lastSyncAt: Date.now(), message: undefined });
    } catch (e) {
      setStatus({ state: 'error', message: (e as Error).message });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(ms = 1500) {
  if (!cryptoKey) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), ms);
}

/** 잠금 해제 후 호출: 바뀐 내용 자동 업로드, 주기적·포커스 시 받기 */
export function startAutoSync() {
  changeListeners.onLocalChange = () => schedule();
  changeListeners.onLocalDelete = (kind, id) => {
    if (kind === 'settings' && LOCAL_ONLY_SETTINGS.has(id)) return;
    meta.tombs.put({ kind, id, at: Date.now() }).then(() => schedule());
  };
  setInterval(() => syncNow().catch(() => {}), 60_000);
  window.addEventListener('focus', () => schedule(200));
  window.addEventListener('online', () => schedule(200));
}

/* ------------------------------------------------------------------ */
/* 전체 교체·삭제                                                        */
/* ------------------------------------------------------------------ */

/** 백업에서 복원한 뒤: 서버를 이 기기 내용과 똑같이 맞춘다 */
export async function replaceRemoteWithLocal() {
  if (!cryptoKey) return;
  await rekeyLocal();
  const { data, error } = await supabase().from('records').select('kind, id').eq('deleted', false);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { kind: SyncKind; id: string }[]) {
    if (!SYNC_TABLES.includes(r.kind)) continue;
    const pk = r.kind === 'items' || r.kind === 'settings' ? r.id : Number(r.id);
    if (!(await db.table(r.kind).get(pk))) await meta.tombs.put({ kind: r.kind, id: r.id, at: Date.now() });
  }
  await setMeta('lastPush', 0);
  await syncNow();
}

/** 서버에 있는 내 기록과 원본 이미지를 모두 지운다 (데이터 비밀번호 설정은 유지) */
export async function wipeRemote() {
  const sb = supabase();
  const { error } = await sb.from('records').delete().eq('user_id', userId!);
  if (error) throw new Error(`서버 기록 삭제 실패: ${error.message}`);
  const { data: folders } = await sb.storage.from('pages').list(userId!, { limit: 1000 });
  for (const f of folders ?? []) {
    const { data: files } = await sb.storage.from('pages').list(`${userId}/${f.name}`);
    if (files?.length) await sb.storage.from('pages').remove(files.map((o) => `${userId}/${f.name}/${o.name}`));
  }
  await meta.tombs.clear();
  await setMeta('lastPull', null);
}
