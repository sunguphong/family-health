import * as XLSX from 'xlsx';
import { db } from './db';
import { GROUPS, STATUS_LABEL } from './types';
import { formatValue, judge, rangeText } from './status';

interface LongRow {
  구성원: string;
  검진일: string;
  검진기관: string;
  그룹: string;
  항목: string;
  값: string;
  단위: string;
  참고범위: string;
  판정: string;
}

async function collect() {
  const [members, exams, results, items] = await Promise.all([
    db.members.toArray(),
    db.exams.toArray(),
    db.results.toArray(),
    db.items.orderBy('order').toArray(),
  ]);
  const memberById = new Map(members.map((m) => [m.id!, m]));
  const examById = new Map(exams.map((e) => [e.id!, e]));
  const defs = new Map(items.map((d) => [d.code, d]));
  const groupLabel = new Map(GROUPS.map((g) => [g.key, g.label]));

  const rows: LongRow[] = [];
  for (const r of results) {
    const e = examById.get(r.examId);
    const m = e && memberById.get(e.memberId);
    const d = defs.get(r.itemCode);
    if (!e || !m || !d) continue;
    rows.push({
      구성원: m.name,
      검진일: e.date,
      검진기관: e.institution,
      그룹: groupLabel.get(d.group) ?? '',
      항목: d.name,
      값: formatValue(d, r.value),
      단위: d.kind === 'grade' ? '' : d.unit,
      참고범위: rangeText(d, m.sex),
      판정: STATUS_LABEL[judge(d, r.value, m.sex)],
    });
  }
  const order = new Map(items.map((d, i) => [d.name, i]));
  rows.sort(
    (a, b) =>
      a.구성원.localeCompare(b.구성원) || a.검진일.localeCompare(b.검진일) || (order.get(a.항목)! - order.get(b.항목)!),
  );
  return { rows, members, exams, results, items };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportCsv() {
  const { rows } = await collect();
  const header = Object.keys(rows[0] ?? { 구성원: '', 검진일: '', 검진기관: '', 그룹: '', 항목: '', 값: '', 단위: '', 참고범위: '', 판정: '' });
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [header.join(','), ...rows.map((r) => header.map((h) => esc(String(r[h as keyof LongRow]))).join(','))].join('\r\n');
  // 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `건강검진이력_${stamp()}.csv`);
}

export async function exportXlsx() {
  const { rows, members, exams, results, items } = await collect();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '전체기록');

  // 구성원별: 항목 × 검진일 표
  for (const m of members) {
    const mine = exams.filter((e) => e.memberId === m.id).sort((a, b) => a.date.localeCompare(b.date));
    if (!mine.length) continue;
    const head = ['그룹', '항목', '단위', '참고범위', ...mine.map((e) => e.date)];
    const body = items
      .map((d) => {
        const vals = mine.map((e) => {
          const r = results.find((x) => x.examId === e.id && x.itemCode === d.code);
          return r ? formatValue(d, r.value) : '';
        });
        if (vals.every((v) => !v)) return null;
        return [GROUPS.find((g) => g.key === d.group)?.label ?? '', d.name, d.kind === 'grade' ? '' : d.unit, rangeText(d, m.sex), ...vals];
      })
      .filter(Boolean) as string[][];
    const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
    ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, ...mine.map(() => ({ wch: 12 }))];
    const sheetName = m.name.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || `구성원${m.id}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `건강검진이력_${stamp()}.xlsx`);
}

/** 기기 이동·백업용 전체 데이터 (원본 페이지 이미지 포함) */
export async function exportBackup() {
  const [members, items, exams, results, files] = await Promise.all([
    db.members.toArray(),
    db.items.toArray(),
    db.exams.toArray(),
    db.results.toArray(),
    db.files.toArray(),
  ]);
  const filesOut = await Promise.all(
    files.map(async (f) => ({ ...f, pages: await Promise.all(f.pages.map(blobToDataUrl)) })),
  );
  const json = JSON.stringify({ app: 'family-health-checkup', version: 1, members, items, exams, results, files: filesOut });
  download(new Blob([json], { type: 'application/json' }), `건강검진백업_${stamp()}.json`);
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'family-health-checkup') throw new Error('이 앱의 백업 파일이 아닙니다.');
  const files = await Promise.all(
    (data.files ?? []).map(async (f: { pages: string[] }) => ({
      ...f,
      pages: await Promise.all(f.pages.map((u) => fetch(u).then((r) => r.blob()))),
    })),
  );
  await db.transaction('rw', [db.members, db.items, db.exams, db.results, db.files], async () => {
    await Promise.all([db.members.clear(), db.items.clear(), db.exams.clear(), db.results.clear(), db.files.clear()]);
    await db.members.bulkAdd(data.members);
    await db.items.bulkAdd(data.items);
    await db.exams.bulkAdd(data.exams);
    await db.results.bulkAdd(data.results);
    await db.files.bulkAdd(files);
  });
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
