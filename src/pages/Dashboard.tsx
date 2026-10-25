import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconArrowRight, IconCalendar, IconGauge, IconInfo, IconPrint, IconTrend, IconUpload } from '../components/Icons';
import { AdviceCard } from '../components/AdviceCard';
import { Modal } from '../components/Modal';
import { StatusBadge, TrendBadge } from '../components/StatusBadge';
import { TrendChart } from '../components/TrendChart';
import { useMemberData } from '../lib/hooks';
import { MemberPicker, useMember } from '../lib/member';
import { bigChange, changeTone, formatValue, formatWithUnit, isWorseningTrend, rangeText, type Change, type Point } from '../lib/status';
import { GROUPS, STATUS_LABEL, type Exam, type GroupKey, type ItemDef, type Sex, type Status } from '../lib/types';

interface ItemView {
  def: ItemDef;
  points: Point[];
  latest: Point;
  prev?: Point;
  trend: boolean;
}

const STATUS_COLOR: Record<'normal' | 'caution' | 'abnormal', string> = {
  normal: 'var(--good)',
  caution: 'var(--warn)',
  abnormal: 'var(--bad)',
};

/** 기록 상세 화면으로 이동하면서 해당 항목을 강조 */
const examLink = (examId: number, itemCode?: string) => `/records/${examId}${itemCode ? `?item=${itemCode}` : ''}`;

export default function Dashboard() {
  const nav = useNavigate();
  const { member, ready } = useMember();
  const { exams, items, series, loading } = useMemberData(member);
  const [group, setGroup] = useState<GroupKey>('body');
  const [statusPopup, setStatusPopup] = useState<'normal' | 'caution' | 'abnormal' | null>(null);

  const latestExam = exams[exams.length - 1];

  const views = useMemo(() => {
    if (!member) return [] as ItemView[];
    return items
      .map((def) => {
        const points = series.get(def.code) ?? [];
        if (!points.length) return null;
        return {
          def,
          points,
          latest: points[points.length - 1],
          prev: points[points.length - 2],
          trend: isWorseningTrend(def, member.sex, points),
        };
      })
      .filter(Boolean) as ItemView[];
  }, [items, series, member]);

  const summary = useMemo(() => {
    const byStatus: Record<Status, ItemView[]> = { normal: [], caution: [], abnormal: [], none: [] };
    const changes: Change[] = [];
    if (!latestExam) return { byStatus, changes };
    for (const v of views) {
      if (v.latest.examId !== latestExam.id) continue;
      byStatus[v.latest.status].push(v);
      const c = bigChange(v.def, v.points, latestExam.id!);
      if (c) changes.push(c);
    }
    return { byStatus, changes };
  }, [views, latestExam]);

  if (!ready) return null;
  if (!member) {
    return (
      <div className="card stack">
        <h1>시작하기</h1>
        <p className="muted">먼저 설정에서 가족 구성원을 추가하거나 샘플 데이터를 불러와 보세요.</p>
        <div className="row">
          <Link className="btn primary" to="/settings">설정으로 가기</Link>
        </div>
      </div>
    );
  }

  const groupViews = views.filter((v) => v.def.group === group);
  const flagged = (g: GroupKey) =>
    views.some((v) => v.def.group === g && (v.trend || v.latest.status === 'caution' || v.latest.status === 'abnormal'));
  const visibleGroups = GROUPS.filter((g) => g.key !== 'etc' || views.some((v) => v.def.group === 'etc'));
  const counts = { normal: summary.byStatus.normal.length, caution: summary.byStatus.caution.length, abnormal: summary.byStatus.abnormal.length };
  const total = counts.normal + counts.caution + counts.abnormal;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">HEALTH OVERVIEW</div>
          <h1>
            <span className="grad-text">{member.name}</span>님의 건강검진 추이
          </h1>
          <div className="sub">총 {exams.length}회 검진 기록 · 항목을 누르면 해당 검진 기록으로 이동합니다</div>
        </div>
        <div className="row">
          <MemberPicker />
          {latestExam && (
            <Link className="btn" to={`/print/${member.id}`}><IconPrint />한 장 요약</Link>
          )}
        </div>
      </div>

      <div className="notice" role="note">
        <IconInfo />
        <span>
          색 표시는 일반적인 참고 기준과 비교한 것이며 진단이 아닙니다. 주의·이상으로 표시되거나 변화가 큰 항목은 다음 진료 때 의료진과 상담해 보세요.
        </span>
      </div>

      {!loading && !latestExam ? (
        <div className="card stack" style={{ alignItems: 'flex-start' }}>
          <h2>아직 검진 기록이 없어요</h2>
          <p className="muted">검진 결과 파일을 올리면 수치를 읽어 여기에 추이를 보여 드립니다.</p>
          <Link className="btn primary" to="/upload"><IconUpload />검진 결과 올리기</Link>
        </div>
      ) : latestExam ? (
        <>
          <div className="bento">
            <Link className="card hero-card" to={examLink(latestExam.id!)} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="stat-label"><IconCalendar />최근 검진</div>
              <div className="stat-value num">{latestExam.date.replace(/-/g, '.')}</div>
              <div className="stat-foot">{latestExam.institution || '기관 미입력'}</div>
              <div className="stat-foot row" style={{ marginTop: 18, color: 'var(--primary)', fontWeight: 600, gap: 6 }}>
                검진 기록 보기 <span style={{ width: 15, height: 15, display: 'inline-flex' }}><IconArrowRight /></span>
              </div>
            </Link>

            <div className="card">
              <div className="stat-label"><IconGauge />최근 검진 판정 <span className="muted" style={{ fontWeight: 500 }}>· 눌러서 항목 보기</span></div>
              <div className="seg" aria-hidden>
                {(['normal', 'caution', 'abnormal'] as const).map((s) =>
                  counts[s] ? <div key={s} style={{ flex: counts[s], background: STATUS_COLOR[s] }} /> : null,
                )}
                {total === 0 && <div style={{ flex: 1, background: 'var(--surface-3)' }} />}
              </div>
              <div className="legend3">
                {(['normal', 'caution', 'abnormal'] as const).map((s) => (
                  <button
                    key={s}
                    className="btn ghost"
                    style={{ display: 'block', textAlign: 'left', padding: '6px 8px', margin: '-6px -8px' }}
                    onClick={() => setStatusPopup(s)}
                    aria-label={`${STATUS_LABEL[s]} ${counts[s]}개 항목 보기`}
                  >
                    <span className="n num" style={{ color: s === 'normal' ? 'var(--ink)' : STATUS_COLOR[s] }}>{counts[s]}</span>
                    <span className="l"><span className="sw" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="stat-label"><IconTrend />직전 검진 대비 크게 변한 항목</div>
              {summary.changes.length === 0 ? (
                <p className="muted small" style={{ marginTop: 14 }}>
                  {exams.length < 2 ? '비교할 이전 검진이 없습니다.' : '크게 변한 항목이 없습니다.'}
                </p>
              ) : (
                <ul className="change-list">
                  {summary.changes.slice(0, 4).map((c) => (
                    <li key={c.def.code} className={`chg-${changeTone(c, member.sex)}`} title={changeTone(c, member.sex) === 'bad' ? '나빠지는 방향의 변화' : changeTone(c, member.sex) === 'good' ? '좋아지는 방향의 변화' : undefined}>
                      <Link to={examLink(c.cur.examId, c.def.code)} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>
                        {c.def.name}
                      </Link>
                      <span className="num row" style={{ gap: 8 }}>
                        <span className="muted">{formatValue(c.def, c.prev.value)} →</span>
                        <b>{formatWithUnit(c.def, c.cur.value)}</b>
                        {c.pct != null && c.def.kind !== 'grade' && (
                          <span className="pct">{c.pct > 0 ? '+' : ''}{Math.round(c.pct * 100)}%</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <AdviceCard member={member} exams={exams} items={items} series={series} />

          <div className="section-head">
            <div className="tabs" role="tablist">
              {visibleGroups.map((g) => (
                <button
                  key={g.key}
                  role="tab"
                  aria-selected={group === g.key}
                  className={`tab ${group === g.key ? 'active' : ''}`}
                  onClick={() => setGroup(g.key)}
                >
                  {g.label}
                  {flagged(g.key) && <span className="dot" style={{ background: 'var(--warn)', color: 'var(--warn)' }} title="확인할 항목 있음" />}
                </button>
              ))}
            </div>
          </div>

          {groupViews.length === 0 ? (
            <p className="muted">이 그룹에는 기록된 항목이 없습니다.</p>
          ) : (
            <div className="grid grid-cards">
              {groupViews.map((v) => (
                <ItemCard
                  key={v.def.code}
                  v={v}
                  sex={member.sex}
                  latestExamId={latestExam.id!}
                  onOpen={(examId) => nav(examLink(examId, v.def.code))}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {statusPopup && latestExam && (
        <StatusModal
          status={statusPopup}
          list={summary.byStatus[statusPopup]}
          exam={latestExam}
          sex={member.sex}
          onClose={() => setStatusPopup(null)}
          onPick={(code) => nav(examLink(latestExam.id!, code))}
        />
      )}
    </>
  );
}

function StatusModal({
  status, list, exam, sex, onClose, onPick,
}: {
  status: 'normal' | 'caution' | 'abnormal';
  list: ItemView[];
  exam: Exam;
  sex: Sex;
  onClose: () => void;
  onPick: (itemCode: string) => void;
}) {
  const desc = {
    normal: '참고 범위 안에 있는 항목입니다.',
    caution: '정상 범위를 살짝 벗어난 경계 구간 항목입니다. 다음 검진 때 변화를 지켜보세요.',
    abnormal: '참고 범위를 벗어난 항목입니다. 의료진과 상담해 보세요.',
  }[status];
  return (
    <Modal title={`${STATUS_LABEL[status]} 항목 ${list.length}개`} onClose={onClose}>
      <p className="small muted" style={{ marginBottom: 14 }}>
        {exam.date.replace(/-/g, '.')} 검진{exam.institution ? ` · ${exam.institution}` : ''} 기준 · {desc}
      </p>
      {list.length === 0 ? (
        <p className="muted">해당하는 항목이 없습니다.</p>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {list.map((v) => (
            <button
              key={v.def.code}
              className="list-row"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', width: '100%', textAlign: 'left' }}
              onClick={() => onPick(v.def.code)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{v.def.name}</div>
                <div className="small muted">참고 범위 {rangeText(v.def, sex)}{v.def.kind !== 'grade' && v.def.unit ? ` ${v.def.unit}` : ''}</div>
              </div>
              <div className="num" style={{ fontWeight: 700, fontSize: 17 }}>{formatWithUnit(v.def, v.latest.value)}</div>
              <StatusBadge status={v.latest.status} />
              <span className="muted" style={{ width: 16, height: 16, display: 'inline-flex' }}><IconArrowRight /></span>
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose}>닫기</button>
      </div>
    </Modal>
  );
}

function ItemCard({ v, sex, latestExamId, onOpen }: { v: ItemView; sex: Sex; latestExamId: number; onOpen: (examId: number) => void }) {
  const { def, latest, prev, trend } = v;
  const stale = latest.examId !== latestExamId;
  const cls = [latest.status === 'caution' || latest.status === 'abnormal' ? latest.status : '', trend ? 'trend' : ''].join(' ');
  const delta = prev && def.kind !== 'grade' ? latest.value - prev.value : null;

  let hint = '';
  if (latest.status === 'abnormal') hint = '참고 범위를 벗어났습니다. 의료진과 상담해 보세요.';
  else if (trend) hint = '최근 계속 나빠지는 방향으로 변하고 있어요. 다음 진료 때 이야기해 보세요.';
  else if (latest.status === 'caution') hint = '경계 구간입니다. 다음 검진 때 변화를 지켜보세요.';

  return (
    <div
      className={`card item-card ${cls}`}
      role="link"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={() => onOpen(latest.examId)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(latest.examId)}
      aria-label={`${def.name} 최근 검진 기록 열기`}
    >
      <div className="item-head">
        <div>
          <h3>{def.name}</h3>
          <div className="item-meta">
            {rangeText(def, sex) === '-'
              ? '기록용 항목'
              : `참고 범위 ${rangeText(def, sex)}${def.kind !== 'grade' && def.unit ? ` ${def.unit}` : ''}`}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
          {trend && <TrendBadge />}
          <StatusBadge status={latest.status} />
        </div>
      </div>
      <div className="row" style={{ alignItems: 'baseline', marginTop: 12, gap: 10 }}>
        <span className="item-value num">
          {formatValue(def, latest.value)}
          {def.kind !== 'grade' && <span className="unit">{def.unit}</span>}
        </span>
        {delta != null && delta !== 0 && (
          <span className="delta num">
            {delta > 0 ? '↑' : '↓'} {formatValue(def, Math.abs(delta))}
          </span>
        )}
        {stale && <span className="small muted">({latest.date.slice(0, 4)}년 기록)</span>}
      </div>
      {hint && <div className="item-hint">{hint}</div>}
      <div style={{ marginTop: 6 }}>
        <TrendChart def={def} sex={sex} points={v.points} onPointClick={(p) => onOpen(p.examId)} />
      </div>
    </div>
  );
}
