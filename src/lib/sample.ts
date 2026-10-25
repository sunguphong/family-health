import { db } from './db';
import type { Result } from './types';

type Row = Record<string, number[]>;

const DATES = ['2022-05-17', '2023-05-23', '2024-06-04', '2025-05-20'];

const ME: Row = {
  height: [172.4, 172.5, 172.3, 172.4],
  weight: [74.0, 76.1, 77.6, 79.2],
  waist: [86, 88, 90, 91.5],
  sbp: [118, 124, 128, 133],
  dbp: [74, 76, 78, 82],
  fbs: [94, 98, 103, 108],
  tc: [188, 201, 212, 226],
  hdl: [63, 61, 62, 58],
  ldl: [118, 131, 142, 155],
  tg: [118, 126, 139, 146],
  hb: [15.1, 15.3, 14.9, 15.0],
  ast: [24, 27, 31, 29],
  alt: [26, 29, 33, 34],
  ggt: [35, 42, 51, 71],
  cr: [0.95, 0.98, 1.01, 1.0],
  egfr: [92, 89, 86, 87],
  uprot: [0, 0, 0, 1],
};

const SPOUSE: Row = {
  height: [161.2, 161.0, 161.1, 161.0],
  weight: [55.3, 54.8, 56.0, 55.6],
  waist: [72, 71.5, 73, 72.5],
  sbp: [108, 112, 110, 114],
  dbp: [70, 72, 70, 74],
  fbs: [88, 91, 87, 92],
  tc: [182, 186, 179, 191],
  hdl: [66, 64, 68, 65],
  ldl: [98, 104, 95, 108],
  tg: [78, 92, 81, 88],
  hb: [12.4, 11.8, 11.5, 12.1],
  ast: [19, 21, 18, 20],
  alt: [14, 16, 13, 15],
  ggt: [15, 17, 14, 16],
  cr: [0.72, 0.7, 0.74, 0.73],
  egfr: [101, 103, 99, 100],
  uprot: [0, 0, 0, 0],
};

async function addMember(name: string, sex: 'M' | 'F', birthYear: number, rows: Row, institutions: string[]) {
  const memberId = (await db.members.add({ name, sex, birthYear, isSample: true })) as number;
  for (let i = 0; i < DATES.length; i++) {
    const examId = (await db.exams.add({
      memberId,
      date: DATES[i],
      institution: institutions[i],
      createdAt: Date.now(),
      isSample: true,
    })) as number;
    const results: Result[] = Object.entries(rows).map(([itemCode, vals]) => ({
      examId,
      itemCode,
      value: vals[i],
      unit: '',
    }));
    const h = rows.height[i] / 100;
    results.push({ examId, itemCode: 'bmi', value: Math.round((rows.weight[i] / (h * h)) * 10) / 10, unit: '' });
    await db.results.bulkAdd(results);
  }
}

export async function loadSampleData() {
  // 한 트랜잭션으로 넣어 화면에 반쯤 들어간 상태가 보이지 않게 한다
  await db.transaction('rw', [db.members, db.exams, db.results, db.files], async () => {
    await removeSampleData();
    await addMember('나 (샘플)', 'M', 1978, ME, ['샘플내과의원', '샘플내과의원', '샘플종합병원 건강검진센터', '샘플종합병원 건강검진센터']);
    await addMember('배우자 (샘플)', 'F', 1981, SPOUSE, ['샘플여성의원', '샘플여성의원', '샘플종합병원 건강검진센터', '샘플종합병원 건강검진센터']);
  });
}

export async function removeSampleData() {
  const exams = await db.exams.filter((e) => !!e.isSample).toArray();
  const ids = exams.map((e) => e.id!);
  await db.results.where('examId').anyOf(ids).delete();
  await db.files.where('examId').anyOf(ids).delete();
  await db.exams.bulkDelete(ids);
  const members = await db.members.filter((m) => !!m.isSample).toArray();
  await db.members.bulkDelete(members.map((m) => m.id!));
}

export async function hasSampleData() {
  return (await db.members.filter((m) => !!m.isSample).count()) > 0;
}
