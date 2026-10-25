import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_ITEMS, normName } from './items';
import type { Exam, ItemDef, Member, Result, Setting, SourceFile } from './types';

export const db = new Dexie('family-health-checkup') as Dexie & {
  members: EntityTable<Member, 'id'>;
  items: EntityTable<ItemDef, 'code'>;
  exams: EntityTable<Exam, 'id'>;
  results: EntityTable<Result, 'id'>;
  files: EntityTable<SourceFile, 'id'>;
  settings: EntityTable<Setting, 'key'>;
};

db.version(1).stores({
  members: '++id',
  items: 'code, group, order',
  exams: '++id, memberId, date',
  results: '++id, examId, itemCode',
  files: '++id, examId',
  settings: 'key',
});

// v2: 동기화를 위해 수정 시각(_m) 색인 추가
db.version(2).stores({
  members: '++id, _m',
  items: 'code, group, order, _m',
  exams: '++id, memberId, date, _m',
  results: '++id, examId, itemCode, _m',
  files: '++id, examId, _m',
  settings: 'key, _m',
});

db.on('populate', async (tx) => {
  await tx.table('items').bulkAdd(DEFAULT_ITEMS);
});

/**
 * 여러 기기에서 만든 기록이 섞여도 겹치지 않는 숫자 ID (시각 기반 + 난수, 2^53 미만).
 * 1~2자리 자동 번호는 기기마다 겹치므로 동기화에는 쓸 수 없다.
 */
export const newId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
export const isGlobalId = (id: number) => id > 1e14;

export type SyncKind = 'members' | 'items' | 'exams' | 'results' | 'files' | 'settings';
export const SYNC_TABLES: SyncKind[] = ['members', 'items', 'exams', 'results', 'files', 'settings'];

/** 동기화 모듈이 바뀐 기록을 알 수 있도록 하는 연결점 */
export const changeListeners = {
  onLocalChange: (_kind: SyncKind) => {},
  onLocalDelete: (_kind: SyncKind, _id: string) => {},
};

/** 서버에서 받은 내용을 반영하는 트랜잭션 표시 (이때는 '바뀜'으로 기록하지 않음) */
export const REMOTE = Symbol('remote');
type Tx = { [REMOTE]?: boolean; on: (ev: 'complete', fn: () => void) => void };

for (const kind of SYNC_TABLES) {
  const table = db.table(kind);
  const autoId = kind === 'members' || kind === 'exams' || kind === 'results' || kind === 'files';
  table.hook('creating', function (primKey, obj, tx) {
    const t = tx as unknown as Tx;
    if (t[REMOTE]) return undefined;
    obj._m = Date.now();
    t.on('complete', () => changeListeners.onLocalChange(kind));
    if (autoId && primKey == null) {
      obj.id = newId();
      return obj.id;
    }
    return undefined;
  });
  table.hook('updating', function (_mods, _primKey, _obj, tx) {
    const t = tx as unknown as Tx;
    if (t[REMOTE]) return undefined;
    t.on('complete', () => changeListeners.onLocalChange(kind));
    return { _m: Date.now() };
  });
  table.hook('deleting', function (primKey, _obj, tx) {
    const t = tx as unknown as Tx;
    if (t[REMOTE]) return;
    t.on('complete', () => changeListeners.onLocalDelete(kind, String(primKey)));
  });
}

/** 업로드 화면에 미리 채워 둘 검진기관 (설정에서 변경 가능) */
export const DEFAULT_INSTITUTION = '하나로의료재단';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export async function deleteExam(examId: number) {
  await db.transaction('rw', db.exams, db.results, db.files, async () => {
    await db.results.where('examId').equals(examId).delete();
    await db.files.where('examId').equals(examId).delete();
    await db.exams.delete(examId);
  });
}

export async function deleteMember(memberId: number) {
  const exams = await db.exams.where('memberId').equals(memberId).toArray();
  for (const e of exams) await deleteExam(e.id!);
  await db.members.delete(memberId);
}

/** 검토 화면에서 사람이 연결해 준 원문 항목명을 별칭으로 학습 */
export async function learnAliases(pairs: { rawName?: string; itemCode: string }[]) {
  for (const { rawName, itemCode } of pairs) {
    if (!rawName) continue;
    const n = normName(rawName);
    if (!n || n.length > 40) continue;
    const def = await db.items.get(itemCode);
    if (!def) continue;
    if (def.aliases.some((a) => normName(a) === n)) continue;
    await db.items.update(itemCode, { aliases: [...def.aliases, rawName] });
  }
}
