import { BP_PAIR_ALIASES, OTHER_TEST_ALIASES, normName, parseGrade } from '../items';
import type { ItemDef, Loc } from '../types';
import type { TextBox } from './pages';

/** 검토 표의 한 줄 */
export interface Candidate {
  key: string;
  rawName: string;
  rawValue: string;
  /** 연결된 표준 항목 코드. ''이면 '저장 안 함' */
  itemCode: string;
  value: string;
  unit: string;
  source: 'local' | 'ai' | 'manual' | 'calc' | 'saved';
  note?: string;
  /** 원본 페이지에서 항목명~값이 있는 위치 */
  loc?: Loc;
}

/** 위치 정보가 붙은 줄 (PDF 텍스트·OCR 결과). 좌표는 캔버스 픽셀 기준 */
export interface SrcLine {
  text: string;
  boxes?: TextBox[];
  page?: number;
  width?: number;
  height?: number;
}

/** 줄 텍스트의 [start, end) 글자 범위에 해당하는 상자들을 합쳐 0~1 비율 좌표로 */
function locOf(src: SrcLine, start: number, end: number): Loc | undefined {
  if (!src.boxes?.length || src.page == null || !src.width || !src.height) return undefined;
  let pos = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of src.boxes) {
    const bs = pos;
    const be = pos + b.text.length;
    pos = be + 1;
    if (bs < end && be > start) {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
  }
  if (!Number.isFinite(x0)) return undefined;
  return { page: src.page, x: x0 / src.width, y: y0 / src.height, w: (x1 - x0) / src.width, h: (y1 - y0) / src.height };
}

let seq = 0;
export const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

interface AliasEntry {
  norm: string;
  code: string; // 항목 코드, 'bp_pair', 또는 '' (다른 검사)
}

export function buildAliasIndex(items: ItemDef[]): AliasEntry[] {
  const list: AliasEntry[] = [];
  for (const d of items) {
    for (const a of [d.name, ...d.aliases]) list.push({ norm: normName(a), code: d.code });
  }
  for (const a of BP_PAIR_ALIASES) list.push({ norm: normName(a), code: 'bp_pair' });
  for (const a of OTHER_TEST_ALIASES) list.push({ norm: normName(a), code: '' });
  // 긴 이름부터 맞춰야 '당화혈색소'가 '혈색소'로, '수축기혈압'이 '혈압'으로 잘못 잡히지 않는다
  return list.filter((e) => e.norm.length >= 2).sort((a, b) => b.norm.length - a.norm.length);
}

/** 원문 항목명 하나를 표준 항목 코드로 바꾼다. 못 찾으면 '' */
export function matchItemName(raw: string, index: AliasEntry[]): string {
  const n = normName(raw);
  if (!n) return '';
  const exact = index.find((e) => e.norm === n);
  if (exact) return exact.code === 'bp_pair' ? '' : exact.code;
  const partial = index.find((e) => e.norm.length >= 3 && n.includes(e.norm));
  return partial && partial.code !== 'bp_pair' ? partial.code : '';
}

const UNIT_RE = /^\s*(mg\/dl|mmhg|g\/dl|u\/l|iu\/l|kg\/m2|kg\/m²|kg|cm|ml\/min\/1\.73\s?m2|ml\/min\/1\.73\s?m²|ml\/min|%)/i;
const NUM_RE = /(?<![\d.])[-+]?\d{1,4}(?:[.,]\d{1,3})?(?![\d])/;

/** 정규화된 문자열의 각 글자가 원문의 몇 번째 글자에서 왔는지 */
function normWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const n = normName(s[i]);
    for (const ch of n) {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}

/**
 * 줄 단위 텍스트에서 항목명과 그 뒤의 값을 찾는다.
 * 같은 줄에 여러 항목이 있으면 다음 항목명 전까지를 앞 항목의 값 영역으로 본다.
 */
export function parseLines(lines: (string | SrcLine)[], items: ItemDef[]): Candidate[] {
  const index = buildAliasIndex(items);
  const defs = new Map(items.map((d) => [d.code, d]));
  const found: Candidate[] = [];

  for (const l of lines) {
    const src: SrcLine = typeof l === 'string' ? { text: l } : l;
    const line = src.text;
    const { norm, map } = normWithMap(line);
    const claimed = new Array(norm.length).fill(false);
    const hits: { start: number; end: number; code: string }[] = [];
    for (const e of index) {
      let from = 0;
      while (true) {
        const at = norm.indexOf(e.norm, from);
        if (at < 0) break;
        from = at + 1;
        if (claimed.slice(at, at + e.norm.length).some(Boolean)) continue;
        // 영문 약어(ast, hdl 등)는 앞뒤가 다른 영문자에 붙어 있으면 무시
        if (/^[a-z]+$/.test(e.norm)) {
          const before = norm[at - 1];
          const after = norm[at + e.norm.length];
          if ((before && /[a-z]/.test(before)) || (after && /[a-z]/.test(after))) continue;
        }
        claimed.fill(true, at, at + e.norm.length);
        hits.push({ start: map[at], end: map[at + e.norm.length - 1] + 1, code: e.code });
      }
    }
    hits.sort((a, b) => a.start - b.start);

    if (!hits.length) {
      // 사전에 없는 검사도 "이름 값 단위" 모양이면 '연결 안 됨' 줄로 보여 줘서 새 항목으로 추가할 수 있게 한다
      const m = line.match(/^\s*([가-힣A-Za-z][가-힣A-Za-z0-9()\-·\s]{0,20}?)\s+([-+]?\d+(?:\.\d+)?)\s*((?:[a-zA-Zµμ%]+\/[a-zA-Z0-9.²]+)|%|[a-zA-Z]{1,4}\/[a-zA-Z]{1,3})(?:\s|$)/);
      if (m && !/검진|날짜|일자|번호|페이지|page/i.test(m[1])) {
        found.push({ key: newKey(), rawName: m[1].trim(), rawValue: m[2], itemCode: '', value: m[2], unit: m[3], source: 'local', loc: locOf(src, 0, m[0].length) });
      }
      continue;
    }

    hits.forEach((h, i) => {
      // "AST(SGOT)"처럼 괄호가 열린 채 끝나면 닫는 괄호까지 이름에 포함
      if ((line.slice(h.start, h.end).match(/\(/g)?.length ?? 0) > (line.slice(h.start, h.end).match(/\)/g)?.length ?? 0)) {
        const close = line.indexOf(')', h.end);
        if (close >= 0 && close - h.end < 3) h.end = close + 1;
      }
      const rawName = line.slice(h.start, h.end).trim();
      const segEnd = i + 1 < hits.length ? hits[i + 1].start : line.length;
      // 항목명 뒤에 붙은 괄호 설명(예: "(최고/최저)", "(SGOT)")은 값 영역에서 뺀다
      const rawSeg = line.slice(h.end, segEnd);
      const seg = rawSeg.replace(/^\s*\([^)]*\)/, '');
      const segStart = h.end + (rawSeg.length - seg.length);
      const at = (m: RegExpMatchArray) => locOf(src, h.start, segStart + m.index! + m[0].length);

      if (h.code === 'bp_pair') {
        const m = seg.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
        if (!m) return;
        found.push(
          { key: newKey(), rawName, rawValue: m[0], itemCode: 'sbp', value: m[1], unit: 'mmHg', source: 'local', loc: at(m) },
          { key: newKey(), rawName, rawValue: m[0], itemCode: 'dbp', value: m[2], unit: 'mmHg', source: 'local', loc: at(m) },
        );
        return;
      }

      const def = h.code ? defs.get(h.code) : undefined;
      if (def?.kind === 'grade') {
        const g = seg.match(/약양성|음성|양성|negative|positive|trace|\(?\s*[±+-]\s*[1-4]?\s*\)?|[1-4]\+/i);
        if (!g) return;
        const v = parseGrade(g[0]);
        found.push({
          key: newKey(), rawName, rawValue: g[0].trim(), itemCode: h.code,
          value: v == null ? g[0].trim() : String(v), unit: '', source: 'local', loc: at(g),
        });
        return;
      }

      const num = seg.match(NUM_RE);
      if (!num) return;
      const after = seg.slice(num.index! + num[0].length);
      const unit = after.match(UNIT_RE)?.[1] ?? def?.unit ?? '';
      found.push({
        key: newKey(), rawName, rawValue: num[0], itemCode: h.code,
        value: num[0].replace(',', '.').replace(/^\+/, ''), unit, source: 'local', loc: at(num),
      });
    });
  }
  return dedupe(found);
}

/** 같은 항목이 여러 번 잡히면 첫 값을 쓰고 나머지 값은 메모로 남긴다 */
export function dedupe(list: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  const byCode = new Map<string, Candidate>();
  const seenOther = new Set<string>();
  for (const c of list) {
    if (!c.itemCode) {
      const k = normName(c.rawName);
      if (seenOther.has(k)) continue;
      seenOther.add(k);
      out.push(c);
      continue;
    }
    const first = byCode.get(c.itemCode);
    if (!first) {
      byCode.set(c.itemCode, c);
      out.push(c);
    } else if (first.value !== c.value) {
      first.note = `다른 값도 발견됨: ${[first.note?.replace(/^다른 값도 발견됨: /, ''), c.rawValue].filter(Boolean).join(', ')}`;
    }
  }
  return out;
}
