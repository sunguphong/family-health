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

db.on('populate', async (tx) => {
  await tx.table('items').bulkAdd(DEFAULT_ITEMS);
});

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
