import type { ItemDef, RangeSet } from './types';

const same = (r: RangeSet) => ({ M: r, F: r });

/**
 * 기본 항목 정의. 판정 기준은 국민건강보험공단 일반건강검진 판정 기준을 바탕으로 한
 * 일반적인 참고값이며, 설정 화면에서 수정할 수 있다.
 */
export const DEFAULT_ITEMS: ItemDef[] = [
  {
    code: 'height', name: '신장(키)', group: 'body', unit: 'cm', kind: 'number', decimals: 1,
    better: 'none', plausible: [100, 220], order: 1,
    aliases: ['신장', '키', 'height', '신장cm'],
  },
  {
    code: 'weight', name: '체중', group: 'body', unit: 'kg', kind: 'number', decimals: 1,
    better: 'none', plausible: [20, 250], order: 2,
    aliases: ['체중', '몸무게', 'weight', 'bodyweight', '체증'],
  },
  {
    code: 'bmi', name: 'BMI', group: 'body', unit: 'kg/m²', kind: 'number', decimals: 1,
    better: 'range', plausible: [10, 60], order: 3,
    ranges: same({ normal: { min: 18.5, max: 24.9 }, caution: { min: 0, max: 29.9 } }),
    aliases: ['bmi', '체질량지수', '비만도', '체질량', 'bodymassindex'],
  },
  {
    code: 'waist', name: '허리둘레', group: 'body', unit: 'cm', kind: 'number', decimals: 1,
    better: 'lower', plausible: [40, 200], order: 4,
    ranges: { M: { normal: { max: 89.9 } }, F: { normal: { max: 84.9 } } },
    aliases: ['허리둘레', '복부둘레', '허리', 'waist', 'waistcircumference'],
  },
  {
    code: 'sbp', name: '수축기 혈압', group: 'body', unit: 'mmHg', kind: 'number', decimals: 0,
    better: 'lower', plausible: [60, 260], order: 5,
    ranges: same({ normal: { max: 119 }, caution: { max: 139 } }),
    aliases: ['수축기혈압', '최고혈압', '수축기', 'sbp', 'systolic', '혈압수축기', '혈압최고'],
  },
  {
    code: 'dbp', name: '이완기 혈압', group: 'body', unit: 'mmHg', kind: 'number', decimals: 0,
    better: 'lower', plausible: [30, 160], order: 6,
    ranges: same({ normal: { max: 79 }, caution: { max: 89 } }),
    aliases: ['이완기혈압', '최저혈압', '이완기', 'dbp', 'diastolic', '혈압이완기', '혈압최저'],
  },
  {
    code: 'fbs', name: '공복혈당', group: 'glucose', unit: 'mg/dL', kind: 'number', decimals: 0,
    better: 'lower', plausible: [30, 600], order: 10,
    ranges: same({ normal: { max: 99 }, caution: { max: 125 } }),
    aliases: ['공복혈당', '공복시혈당', '혈당', '식전혈당', 'fbs', 'glucose', 'fastingglucose', 'fastingbloodsugar', 'glu'],
  },
  {
    code: 'tc', name: '총콜레스테롤', group: 'lipid', unit: 'mg/dL', kind: 'number', decimals: 0,
    better: 'lower', plausible: [50, 500], order: 20,
    ranges: same({ normal: { max: 199 }, caution: { max: 239 } }),
    aliases: ['총콜레스테롤', '콜레스테롤', 'totalcholesterol', 'tc', 'tchol', 'cholesterol'],
  },
  {
    code: 'hdl', name: 'HDL 콜레스테롤', group: 'lipid', unit: 'mg/dL', kind: 'number', decimals: 0,
    better: 'higher', plausible: [5, 200], order: 21,
    ranges: same({ normal: { min: 60 }, caution: { min: 40 } }),
    aliases: ['hdl콜레스테롤', 'hdl', '고밀도콜레스테롤', '고밀도지단백콜레스테롤', 'hdlc', 'hdlcholesterol'],
  },
  {
    code: 'ldl', name: 'LDL 콜레스테롤', group: 'lipid', unit: 'mg/dL', kind: 'number', decimals: 0,
    better: 'lower', plausible: [10, 400], order: 22,
    ranges: same({ normal: { max: 129 }, caution: { max: 159 } }),
    aliases: ['ldl콜레스테롤', 'ldl', '저밀도콜레스테롤', '저밀도지단백콜레스테롤', 'ldlc', 'ldlcholesterol'],
  },
  {
    code: 'tg', name: '중성지방', group: 'lipid', unit: 'mg/dL', kind: 'number', decimals: 0,
    better: 'lower', plausible: [10, 3000], order: 23,
    ranges: same({ normal: { max: 149 }, caution: { max: 199 } }),
    aliases: ['중성지방', '트리글리세라이드', '트리글리세리드', 'tg', 'triglyceride', 'triglycerides'],
  },
  {
    code: 'ast', name: 'AST', group: 'liver', unit: 'U/L', kind: 'number', decimals: 0,
    better: 'lower', plausible: [1, 2000], order: 30,
    ranges: same({ normal: { max: 40 }, caution: { max: 50 } }),
    aliases: ['ast', 'sgot', 'ast(sgot)', '에이에스티', '아스파라테이트아미노전이효소'],
  },
  {
    code: 'alt', name: 'ALT', group: 'liver', unit: 'U/L', kind: 'number', decimals: 0,
    better: 'lower', plausible: [1, 2000], order: 31,
    ranges: same({ normal: { max: 35 }, caution: { max: 45 } }),
    aliases: ['alt', 'sgpt', 'alt(sgpt)', '에이엘티', '알라닌아미노전이효소'],
  },
  {
    code: 'ggt', name: '감마GTP', group: 'liver', unit: 'U/L', kind: 'number', decimals: 0,
    better: 'lower', plausible: [1, 3000], order: 32,
    ranges: {
      M: { normal: { min: 11, max: 63 }, caution: { min: 0, max: 77 } },
      F: { normal: { min: 8, max: 35 }, caution: { min: 0, max: 45 } },
    },
    aliases: ['감마지티피', '감마gtp', 'γ-gtp', 'γgtp', 'r-gtp', 'rgtp', 'y-gtp', 'ygtp', 'ggt', 'ggtp', 'gammagt', 'gammagtp', '감마글루타밀전이효소', 'γ-gt'],
  },
  {
    code: 'cr', name: '혈청 크레아티닌', group: 'kidney', unit: 'mg/dL', kind: 'number', decimals: 2,
    better: 'lower', plausible: [0.1, 20], order: 40,
    ranges: same({ normal: { max: 1.5 } }),
    aliases: ['혈청크레아티닌', '크레아티닌', '크레아티닌혈청', 'creatinine', 'cr', 'scr', 'creat'],
  },
  {
    code: 'egfr', name: 'eGFR', group: 'kidney', unit: 'mL/min/1.73m²', kind: 'number', decimals: 0,
    better: 'higher', plausible: [1, 200], order: 41,
    ranges: same({ normal: { min: 60 } }),
    aliases: ['egfr', '신사구체여과율', '사구체여과율', '추정사구체여과율', 'gfr'],
  },
  {
    code: 'uprot', name: '요단백', group: 'kidney', unit: '', kind: 'grade', decimals: 0,
    better: 'lower', plausible: [0, 5], order: 42,
    ranges: same({ normal: { max: 0 }, caution: { max: 1 } }),
    aliases: ['요단백', '단백뇨', '뇨단백', '요단백질', 'urineprotein', 'protein', 'uprotein'],
  },
  {
    code: 'hb', name: '혈색소', group: 'anemia', unit: 'g/dL', kind: 'number', decimals: 1,
    better: 'range', plausible: [3, 25], order: 50,
    ranges: {
      M: { normal: { min: 13, max: 16.5 }, caution: { min: 12, max: 17.5 } },
      F: { normal: { min: 12, max: 15.5 }, caution: { min: 10, max: 16.5 } },
    },
    aliases: ['혈색소', '헤모글로빈', 'hb', 'hgb', 'hemoglobin', 'haemoglobin'],
  },
];

/** 혈압이 "120/80"처럼 한 칸에 적힌 경우를 위한 별칭 (수축기/이완기 둘 다 생성) */
export const BP_PAIR_ALIASES = ['혈압', '혈압최고최저', '혈압수축기이완기', 'bloodpressure', 'bp'];

/**
 * 기본 항목과 이름이 겹치는 다른 검사들. 먼저 잡아서 엉뚱한 항목으로 연결되지 않게 하고,
 * 검토 표에는 '연결 안 됨'으로 보여 준다. (예: 당화혈색소 ≠ 혈색소, CRP ≠ 크레아티닌)
 */
export const OTHER_TEST_ALIASES = [
  '당화혈색소', 'hba1c', 'a1c', 'crp', 'creactiveprotein', 'hscrp', '요잠혈', '요당', '요비중', '요ph',
  '총단백', '알부민', 'albumin', 'bun', '요소질소', '혈중요소질소', '요산', 'uricacid', '빌리루빈', 'bilirubin',
  'alp', '알칼리성인산분해효소', 'tsh', 'ft4', '갑상선', 'psa', 'cea', 'afp', 'ca199', 'ca125',
  '평균적혈구혈색소량', '평균적혈구혈색소농도', '공복인슐린', '인슐린', '적혈구', 'rbc', '백혈구', 'wbc', '혈소판', 'plt', '헤마토크릿', 'hct', 'mcv', 'mch', 'mchc',
  'ldh', '나트륨', '칼륨', '칼슘', '시력', '청력', '흉부방사선', '골밀도', '식후혈당',
];

export const GRADE_LABELS = ['음성', '약양성(±)', '양성(+1)', '양성(+2)', '양성(+3)', '양성(+4)'];

/** 항목명 비교용 정규화: 소문자, 공백·괄호·기호 제거 */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s()[\]{}·・.,:;_\-‐–—/\\|'"`*※]/g, '');
}

/** 요단백 같은 단계형 값 해석. 해석 실패 시 null */
export function parseGrade(raw: string): number | null {
  const s = raw.replace(/\s/g, '').toLowerCase();
  if (!s) return null;
  if (/약양성|trace|±|\+-|-\+/.test(s)) return 1;
  const plus = s.match(/(?:양성)?\(?\+([1-4])\)?|([1-4])\+/);
  if (plus) return 1 + Number(plus[1] ?? plus[2]);
  if (/^\++$/.test(s)) return 1 + Math.min(4, s.length);
  if (/음성|negative|neg|^-$|^\(-\)$/.test(s)) return 0;
  if (/양성|positive|pos/.test(s)) return 2;
  if (/^[0-5]$/.test(s)) return Number(s);
  return null;
}
