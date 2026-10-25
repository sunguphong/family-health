import { db, learnAliases } from './db';
import type { Candidate } from './extract/parse';
import { checkCandidate } from './review';
import type { ItemDef, Result } from './types';

/** 저장 전에 막아야 할 문제(빈 값, 숫자 아님, 중복)를 찾는다. 경고성 문제는 막지 않는다. */
export function blockingProblems(rows: Candidate[], items: ItemDef[]): string[] {
  const defs = new Map(items.map((d) => [d.code, d]));
  const mapped = rows.filter((r) => r.itemCode);
  const out: string[] = [];
  const bad = mapped.filter((r) => checkCandidate(r, defs.get(r.itemCode), rows).value == null);
  if (bad.length) out.push(`값이 비었거나 읽을 수 없는 줄 ${bad.length}개: ${bad.map((r) => defs.get(r.itemCode)?.name).join(', ')}`);
  const counts = new Map<string, number>();
  mapped.forEach((r) => counts.set(r.itemCode, (counts.get(r.itemCode) ?? 0) + 1));
  const dup = [...counts].filter(([, n]) => n > 1).map(([c]) => defs.get(c)?.name);
  if (dup.length) out.push(`같은 항목이 여러 줄: ${dup.join(', ')} — 하나만 남겨 주세요`);
  if (!mapped.length) out.push('저장할 항목이 없습니다');
  return out;
}

export function toResults(examId: number, rows: Candidate[], items: ItemDef[]): Result[] {
  const defs = new Map(items.map((d) => [d.code, d]));
  return rows
    .filter((r) => r.itemCode)
    .map((r) => {
      const def = defs.get(r.itemCode)!;
      return {
        examId,
        itemCode: r.itemCode,
        value: checkCandidate(r, def, rows).value!,
        unit: def.unit,
        rawName: r.rawName || undefined,
        rawValue: r.rawValue || undefined,
        loc: r.loc,
      };
    });
}

export async function replaceResults(examId: number, rows: Candidate[], items: ItemDef[]) {
  await db.transaction('rw', db.results, async () => {
    await db.results.where('examId').equals(examId).delete();
    await db.results.bulkAdd(toResults(examId, rows, items));
  });
  // 자동 추출된 이름을 사람이 다른 항목으로 연결했다면 다음부터 자동으로 연결되도록 학습
  await learnAliases(rows.filter((r) => r.itemCode && r.source !== 'calc' && r.source !== 'saved'));
}
