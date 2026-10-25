export type Sex = 'M' | 'F';
export type GroupKey = 'body' | 'glucose' | 'lipid' | 'liver' | 'kidney' | 'anemia' | 'etc';
export type Status = 'normal' | 'caution' | 'abnormal' | 'none';

export interface Range {
  min?: number;
  max?: number;
}

/** normal: 정상 범위. caution: 정상 바깥이지만 이 범위 안이면 '주의'. 그 밖은 '이상'. */
export interface RangeSet {
  normal: Range;
  caution?: Range;
}

export interface ItemDef {
  code: string;
  name: string;
  group: GroupKey;
  unit: string;
  aliases: string[];
  /** grade: 요단백처럼 음성/약양성/양성 단계로 기록되는 항목 (0=음성, 1=약양성, 2~5=+1~+4) */
  kind: 'number' | 'grade';
  decimals: number;
  /** 어느 방향이 '나빠지는' 방향인지. none이면 추세 판정 안 함 */
  better: 'lower' | 'higher' | 'range' | 'none';
  ranges?: { M: RangeSet; F: RangeSet };
  /** 추출 값이 이 범위를 벗어나면 검토 단계에서 경고 */
  plausible?: [number, number];
  order: number;
  custom?: boolean;
}

export interface Member {
  id?: number;
  name: string;
  sex: Sex;
  birthYear?: number;
  isSample?: boolean;
}

export interface Exam {
  id?: number;
  memberId: number;
  date: string; // YYYY-MM-DD
  institution: string;
  note?: string;
  createdAt: number;
  isSample?: boolean;
}

/** 원본 페이지 위치. page는 검진 기록의 전체 페이지 순번(0부터), 좌표는 페이지 크기 대비 0~1 */
export interface Loc {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Result {
  id?: number;
  examId: number;
  itemCode: string;
  value: number;
  unit: string;
  rawName?: string;
  rawValue?: string;
  loc?: Loc;
}

export interface SourceFile {
  id?: number;
  examId: number;
  name: string;
  /** 식별정보를 가린 뒤 이미지로 변환한 페이지들. 원본 파일은 저장하지 않는다. */
  pages: Blob[];
  maskedCount: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'body', label: '비만·혈압' },
  { key: 'glucose', label: '혈당' },
  { key: 'lipid', label: '지질' },
  { key: 'liver', label: '간' },
  { key: 'kidney', label: '신장' },
  { key: 'anemia', label: '빈혈' },
  { key: 'etc', label: '기타' },
];

export const STATUS_LABEL: Record<Status, string> = {
  normal: '정상',
  caution: '주의',
  abnormal: '이상',
  none: '참고',
};
