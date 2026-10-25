import { GRADE_LABELS } from './items';
import type { Exam, ItemDef, Range, RangeSet, Result, Sex, Status } from './types';

const inRange = (r: Range | undefined, v: number) =>
  !!r && (r.min == null || v >= r.min) && (r.max == null || v <= r.max);

export function rangeFor(def: ItemDef, sex: Sex): RangeSet | undefined {
  return def.ranges?.[sex];
}

export function judge(def: ItemDef, value: number, sex: Sex): Status {
  const r = rangeFor(def, sex);
  if (!r) return 'none';
  if (inRange(r.normal, value)) return 'normal';
  if (r.caution && inRange(r.caution, value)) return 'caution';
  return 'abnormal';
}

export function formatValue(def: ItemDef, value: number): string {
  if (def.kind === 'grade') return GRADE_LABELS[Math.round(value)] ?? String(value);
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: def.decimals,
    maximumFractionDigits: def.decimals,
  });
}

export function formatWithUnit(def: ItemDef, value: number): string {
  const v = formatValue(def, value);
  return def.unit && def.kind !== 'grade' ? `${v} ${def.unit}` : v;
}

export function rangeText(def: ItemDef, sex: Sex): string {
  const r = rangeFor(def, sex)?.normal;
  if (!r) return '-';
  if (def.kind === 'grade') return '음성';
  const f = (n: number) => formatValue(def, n);
  if (r.min != null && r.max != null) return `${f(r.min)}~${f(r.max)}`;
  if (r.max != null) return `${f(r.max)} 이하`;
  if (r.min != null) return `${f(r.min)} 이상`;
  return '-';
}

export interface Point {
  examId: number;
  date: string;
  value: number;
  status: Status;
}

/** 한 구성원의 항목별 시계열 (날짜 오름차순) */
export function buildSeries(
  exams: Exam[],
  results: Result[],
  items: ItemDef[],
  sex: Sex,
): Map<string, Point[]> {
  const examById = new Map(exams.map((e) => [e.id!, e]));
  const defs = new Map(items.map((d) => [d.code, d]));
  const map = new Map<string, Point[]>();
  for (const r of results) {
    const e = examById.get(r.examId);
    const def = defs.get(r.itemCode);
    if (!e || !def) continue;
    const arr = map.get(r.itemCode) ?? [];
    arr.push({ examId: e.id!, date: e.date, value: r.value, status: judge(def, r.value, sex) });
    map.set(r.itemCode, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

/** 값이 나빠지는 방향으로 움직였는지 */
function worsened(def: ItemDef, sex: Sex, a: number, b: number): boolean {
  switch (def.better) {
    case 'lower':
      return b > a;
    case 'higher':
      return b < a;
    case 'range': {
      const n = rangeFor(def, sex)?.normal;
      if (!n || n.min == null || n.max == null) return false;
      const mid = (n.min + n.max) / 2;
      return Math.abs(b - mid) > Math.abs(a - mid);
    }
    default:
      return false;
  }
}

/** 최근 3회 검진값이 연속으로 나빠지는 방향으로 움직였는지 (전체 변화가 5% 미만이면 제외) */
export function isWorseningTrend(def: ItemDef, sex: Sex, pts: Point[]): boolean {
  if (pts.length < 3 || def.better === 'none') return false;
  const [a, b, c] = pts.slice(-3).map((p) => p.value);
  if (!worsened(def, sex, a, b) || !worsened(def, sex, b, c)) return false;
  if (def.kind === 'grade') return true;
  return a !== 0 && Math.abs(c - a) / Math.abs(a) >= 0.05;
}

export interface Change {
  def: ItemDef;
  prev: Point;
  cur: Point;
  pct: number | null;
}

/** 직전 검진 대비 크게 변한 항목: 15% 이상 변화했거나 판정 단계가 바뀐 경우 */
export function bigChange(def: ItemDef, pts: Point[], latestExamId: number): Change | null {
  if (pts.length < 2) return null;
  const cur = pts[pts.length - 1];
  if (cur.examId !== latestExamId) return null;
  const prev = pts[pts.length - 2];
  const pct = prev.value !== 0 ? (cur.value - prev.value) / Math.abs(prev.value) : null;
  const statusChanged = cur.status !== prev.status && cur.status !== 'none';
  const large = def.kind === 'grade' ? cur.value !== prev.value : pct != null && Math.abs(pct) >= 0.15;
  return statusChanged || large ? { def, prev, cur, pct } : null;
}

export function ageOf(birthYear: number | undefined, at = new Date()): number | null {
  return birthYear ? at.getFullYear() - birthYear : null;
}

const RANK: Record<Status, number> = { none: -1, normal: 0, caution: 1, abnormal: 2 };

/** 직전 대비 변화가 건강에 나쁜 쪽인지: 판정 단계가 나빠졌거나, 나쁜 방향으로 움직였으면 bad */
export function changeTone(c: Change, sex: Sex): 'bad' | 'good' | 'neutral' {
  const { def, prev, cur } = c;
  if (cur.status !== 'none' && prev.status !== 'none' && cur.status !== prev.status) {
    return RANK[cur.status] > RANK[prev.status] ? 'bad' : 'good';
  }
  if (worsened(def, sex, prev.value, cur.value)) return 'bad';
  if (worsened(def, sex, cur.value, prev.value)) return 'good';
  return 'neutral';
}
