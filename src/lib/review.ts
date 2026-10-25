import { normName, parseGrade } from './items';
import type { Candidate } from './extract/parse';
import type { ItemDef } from './types';

export interface Checked {
  value: number | null;
  warnings: string[];
}

const normUnit = (u: string) => normName(u).replace('²', '2').replace('iu', 'u');

export function checkCandidate(c: Candidate, def: ItemDef | undefined, all: Candidate[]): Checked {
  const warnings: string[] = [];
  if (!def) return { value: null, warnings };
  let value: number | null;
  if (def.kind === 'grade') {
    value = parseGrade(c.value);
    if (value == null) warnings.push('음성 / 약양성 / 양성(+1~+4) 중 하나로 입력해 주세요');
  } else {
    const n = Number(c.value.replace(/,/g, '').trim());
    value = c.value.trim() !== '' && Number.isFinite(n) ? n : null;
    if (value == null) warnings.push('숫자가 아닙니다');
    else if (def.plausible && (value < def.plausible[0] || value > def.plausible[1]))
      warnings.push('일반적으로 나오기 어려운 값입니다. 원본과 비교해 주세요');
  }
  if (c.unit && def.unit && def.kind !== 'grade' && normUnit(c.unit) !== normUnit(def.unit))
    warnings.push(`단위가 다릅니다(원문 ${c.unit}). ${def.unit} 기준 값인지 확인해 주세요`);
  if (all.filter((x) => x.itemCode === c.itemCode).length > 1) warnings.push('같은 항목이 여러 줄 있습니다');
  if (c.note) warnings.push(c.note);
  return { value, warnings };
}

/** 키와 몸무게가 있는데 BMI가 없으면 계산해서 넣는다 */
export function fillBmi(list: Candidate[]): Candidate[] {
  if (list.some((c) => c.itemCode === 'bmi')) return list;
  const h = Number(list.find((c) => c.itemCode === 'height')?.value);
  const w = Number(list.find((c) => c.itemCode === 'weight')?.value);
  if (!(h > 0 && w > 0)) return list;
  const bmi = Math.round((w / (h / 100) ** 2) * 10) / 10;
  return [
    ...list,
    { key: `bmi${Date.now()}`, rawName: '(신장·체중으로 계산)', rawValue: '', itemCode: 'bmi', value: String(bmi), unit: 'kg/m²', source: 'calc' },
  ];
}
