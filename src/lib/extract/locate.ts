import { db } from '../db';
import type { ItemDef, Loc, Result } from '../types';
import { readFilePages, type Progress } from './pages';
import { parseLines } from './parse';

/**
 * 위치 정보 없이 저장된 기록(이 기능 이전에 올린 기록)을 위해, 저장된 원본 이미지에서
 * 글자를 다시 읽어 항목 위치를 찾고 DB에 저장한다. 값이 같은 위치를 우선한다.
 */
export async function locateResults(
  pages: Blob[],
  results: Result[],
  items: ItemDef[],
  progress: Progress,
  onlyCode?: string,
): Promise<Map<string, Loc>> {
  const want = new Map(results.filter((r) => !r.loc).map((r) => [r.itemCode, r]));
  const found = new Map<string, { loc: Loc; exact: boolean }>();
  const done = () => (onlyCode ? found.get(onlyCode)?.exact : [...want.keys()].every((c) => found.get(c)?.exact));

  for (let i = 0; i < pages.length && !done(); i++) {
    progress(`원본 ${i + 1}/${pages.length}쪽에서 위치 찾는 중`, i / pages.length);
    const file = new File([pages[i]], `page-${i + 1}.jpg`, { type: 'image/jpeg' });
    const [page] = await readFilePages(file, () => {}, async () => null);
    const lines = page.lines.map((l) => ({ text: l.text, boxes: l.boxes, page: i, width: page.canvas.width, height: page.canvas.height }));
    // dedupe 전에 모든 후보를 봐야 하므로 줄마다 따로 해석한다
    for (const line of lines) {
      for (const c of parseLines([line], items)) {
        const r = want.get(c.itemCode);
        if (!r || !c.loc) continue;
        const exact = Math.abs(Number(c.value) - r.value) < 1e-6;
        const prev = found.get(c.itemCode);
        if (!prev || (exact && !prev.exact)) found.set(c.itemCode, { loc: c.loc, exact });
      }
    }
  }

  const out = new Map<string, Loc>();
  for (const [code, { loc }] of found) {
    out.set(code, loc);
    const r = want.get(code);
    if (r?.id != null) await db.results.update(r.id, { loc });
  }
  return out;
}
