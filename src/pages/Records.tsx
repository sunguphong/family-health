import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowRight, IconPlus } from '../components/Icons';
import { db } from '../lib/db';
import { exportCsv, exportXlsx } from '../lib/export';
import { useMemberData } from '../lib/hooks';
import { MemberPicker, useMember } from '../lib/member';
import { judge } from '../lib/status';
import type { Status } from '../lib/types';

export default function Records() {
  const { member } = useMember();
  const { exams, results, items } = useMemberData(member);
  const fileCounts = useLiveQuery(async () => {
    const files = await db.files.where('examId').anyOf(exams.map((e) => e.id!)).toArray();
    const m = new Map<number, number>();
    files.forEach((f) => m.set(f.examId, (m.get(f.examId) ?? 0) + f.pages.length));
    return m;
  }, [exams]);
  const [busy, setBusy] = useState(false);

  const defs = new Map(items.map((d) => [d.code, d]));
  const byYear = new Map<string, typeof exams>();
  [...exams].reverse().forEach((e) => {
    const y = e.date.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), e]);
  });

  const counts = (examId: number) => {
    const c: Record<Status, number> = { normal: 0, caution: 0, abnormal: 0, none: 0 };
    for (const r of results) {
      if (r.examId !== examId) continue;
      const d = defs.get(r.itemCode);
      if (d && member) c[judge(d, r.value, member.sex)]++;
    }
    return c;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      alert(`내보내기 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">RECORDS</div>
          <h1>검진 기록</h1>
          <div className="sub">연도별 기록을 열어 수치를 고치거나 원본을 다시 볼 수 있어요</div>
        </div>
        <MemberPicker />
      </div>

      <div className="card">
        <div className="card-title">
          <h2>{member?.name ?? ''} 기록</h2>
          <Link className="btn primary sm" to="/upload"><IconPlus />새 검진 올리기</Link>
        </div>
        {exams.length === 0 && <p className="muted">기록이 없습니다.</p>}
        {[...byYear.entries()].map(([year, list]) => (
          <div key={year}>
            <div className="year-head">{year}년</div>
            {list.map((e) => {
              const c = counts(e.id!);
              const n = fileCounts?.get(e.id!) ?? 0;
              return (
                <Link key={e.id} className="list-row" to={`/records/${e.id}`}>
                  <div className="date-pill num"><b>{e.date.slice(5).replace('-', '.')}</b><span>{e.date.slice(0, 4)}</span></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650 }}>{e.institution || '기관 미입력'}</div>
                    <div className="small muted row" style={{ gap: 6, marginTop: 4 }}>
                      <span className="badge normal">정상 {c.normal}</span>
                      {c.caution > 0 && <span className="badge caution">주의 {c.caution}</span>}
                      {c.abnormal > 0 && <span className="badge abnormal">이상 {c.abnormal}</span>}
                      <span>{n ? `원본 ${n}쪽` : e.isSample ? '샘플 데이터' : '원본 없음'}</span>
                    </div>
                  </div>
                  <span className="muted" style={{ width: 18, height: 18, display: 'inline-flex' }}><IconArrowRight /></span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title"><h2>내보내기</h2></div>
        <p className="small muted" style={{ marginBottom: 10 }}>모든 구성원의 전체 이력을 파일로 저장합니다. 파일은 이 기기에만 저장됩니다.</p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => run(exportCsv)}>CSV 내보내기</button>
          <button className="btn" disabled={busy} onClick={() => run(exportXlsx)}>엑셀 내보내기</button>
          {member && <Link className="btn" to={`/print/${member.id}`}>한 장 요약 PDF ({member.name})</Link>}
        </div>
      </div>
    </>
  );
}
