import type { RawPage, TextBox } from './pages';

/** 주민등록번호(일부 가려진 형태 포함), 외국인등록번호, 휴대전화 번호 */
const ID_PATTERNS = [
  /(?<!\d)\d{2}\s?[01]\d\s?[0-3]\d\s*[-–—]\s*[1-8][\d*xX●○]{0,6}/g,
  /(?<!\d)\d{2}[01]\d[0-3]\d\s?[1-8]\d{6}(?!\d)/g,
  /(?<!\d)01[016789]\s*-?\s*\d{3,4}\s*-?\s*\d{4}(?!\d)/g,
];
const ID_LABEL = /주민\s*(등록)?\s*번\s*호|외국인\s*등록\s*번\s*호|생년월일|휴대\s*전화|연락처/;

/**
 * 페이지 이미지에서 식별정보 위치를 검은 칸으로 덮고, 텍스트에서도 지운다.
 * 반환값은 가린 칸 수.
 */
export function maskPage(page: RawPage): number {
  const ctx = page.canvas.getContext('2d')!;
  let count = 0;
  const cover = (b: TextBox) => {
    ctx.fillStyle = '#111';
    ctx.fillRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
    count++;
  };

  for (const line of page.lines) {
    // 각 상자가 줄 텍스트의 어디서 시작하는지 기록 (상자 사이 공백 1칸)
    const starts: number[] = [];
    let pos = 0;
    for (const b of line.boxes) {
      starts.push(pos);
      pos += b.text.length + 1;
    }
    const hit = new Set<number>();
    for (const re of ID_PATTERNS) {
      for (const m of line.text.matchAll(re)) {
        const s = m.index!;
        const e = s + m[0].length;
        line.boxes.forEach((b, i) => {
          if (starts[i] < e && starts[i] + b.text.length > s) hit.add(i);
        });
      }
    }
    // "주민등록번호: ……" 처럼 이름표가 있는 줄은 이름표 뒤 숫자 칸을 모두 가린다
    const label = line.text.match(ID_LABEL);
    if (label) {
      const after = label.index! + label[0].length;
      line.boxes.forEach((b, i) => {
        if (starts[i] >= after - 1 && /\d/.test(b.text)) hit.add(i);
      });
    }
    if (!hit.size) continue;
    [...hit].forEach((i) => cover(line.boxes[i]));
    line.boxes = line.boxes.map((b, i) => (hit.has(i) ? { ...b, text: '[가림]' } : b));
    line.text = line.boxes.map((b) => b.text).join(' ');
  }
  return count;
}
