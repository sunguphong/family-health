import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { db } from '../lib/db';
import { useMemberData } from '../lib/hooks';
import { ageOf, formatValue, isWorseningTrend, rangeText } from '../lib/status';
import { GROUPS, type Status } from '../lib/types';

const MARK: Record<Status, string> = { normal: '', caution: '▲', abnormal: '■', none: '' };

export default function PrintSummary() {
  const memberId = Number(useParams().memberId);
  const member = useLiveQuery(() => db.members.get(memberId), [memberId]);
  const { exams, items, series } = useMemberData(member);

  if (!member) return null;
  const cols = exams.slice(-5);
  const age = ageOf(member.birthYear);

  return (
    <>
      <div className="print-toolbar no-print">
        <Link className="btn" to="/">‹ 돌아가기</Link>
        <button className="btn primary" onClick={() => window.print()}>인쇄 / PDF로 저장</button>
        <span className="small muted" style={{ alignSelf: 'center' }}>인쇄 창에서 ‘PDF로 저장’을 고르면 파일로 저장됩니다.</span>
      </div>
      <div className="print-page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1>건강검진 결과 이력 요약</h1>
            <div style={{ marginTop: 4 }}>
              {member.name} · {member.sex === 'M' ? '남' : '여'}{age ? ` · ${member.birthYear}년생` : ''} · 최근 검진 {cols.length}회
            </div>
          </div>
          <div style={{ textAlign: 'right', color: '#555' }}>작성일 {new Date().toLocaleDateString('ko-KR')}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: '12%' }}>구분</th>
              <th style={{ width: '17%' }}>항목</th>
              <th style={{ width: '11%' }}>단위</th>
              <th style={{ width: '12%' }}>참고범위</th>
              {cols.map((e) => (
                <th key={e.id}>{e.date.replace(/-/g, '.')}<div style={{ fontWeight: 400, fontSize: 9 }}>{e.institution}</div></th>
              ))}
              <th style={{ width: '8%' }}>비고</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => {
              const defs = items.filter((d) => d.group === g.key && (series.get(d.code)?.length ?? 0) > 0);
              return defs.map((d, i) => {
                const pts = series.get(d.code)!;
                const trend = isWorseningTrend(d, member.sex, pts);
                return (
                  <tr key={d.code}>
                    {i === 0 && <td className="grp" rowSpan={defs.length}>{g.label}</td>}
                    <td className="l">{d.name}</td>
                    <td>{d.kind === 'grade' ? '' : d.unit}</td>
                    <td>{rangeText(d, member.sex)}</td>
                    {cols.map((e) => {
                      const p = pts.find((x) => x.examId === e.id);
                      return (
                        <td key={e.id} className={p ? `mk-${p.status}` : ''}>
                          {p ? `${MARK[p.status]}${MARK[p.status] ? ' ' : ''}${formatValue(d, p.value)}` : '-'}
                        </td>
                      );
                    })}
                    <td>{trend ? '연속 악화' : ''}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>

        <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>표시: <span className="mk-caution">▲ 주의(경계)</span> · <span className="mk-abnormal">■ 참고범위 벗어남</span> · 연속 악화 = 최근 3회 연속 나빠지는 방향</span>
        </div>
        <div style={{ marginTop: 10, border: '1px solid #bbb', minHeight: 60, padding: 6 }}>
          <b>진료 때 여쭤볼 것</b>
        </div>
        <p style={{ marginTop: 8, color: '#555' }}>
          ※ 개인이 기록한 검진 결과를 정리한 참고 자료입니다. 판정 표시는 일반적인 참고 기준과 단순 비교한 것으로 진단이 아니며,
          검진 기관의 판정이나 원본 결과지와 다를 수 있습니다.
        </p>
      </div>
    </>
  );
}
