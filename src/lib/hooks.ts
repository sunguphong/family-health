import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from './db';
import { buildSeries, type Point } from './status';
import type { Member } from './types';

export function useItems() {
  return useLiveQuery(() => db.items.orderBy('order').toArray(), []) ?? [];
}

/** 한 구성원의 검진·결과·항목별 시계열 */
export function useMemberData(member: Member | undefined) {
  const items = useItems();
  const data = useLiveQuery(async () => {
    if (member?.id == null) return { exams: [], results: [] };
    const exams = (await db.exams.where('memberId').equals(member.id).toArray()).sort((a, b) => a.date.localeCompare(b.date));
    const results = await db.results.where('examId').anyOf(exams.map((e) => e.id!)).toArray();
    return { exams, results };
  }, [member?.id]);

  const series = useMemo(
    () => (data && member ? buildSeries(data.exams, data.results, items, member.sex) : new Map<string, Point[]>()),
    [data, items, member],
  );

  return { loading: !data, exams: data?.exams ?? [], results: data?.results ?? [], items, series };
}
