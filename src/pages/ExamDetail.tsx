import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { IconChevronLeft } from '../components/Icons';
import { PageViewer } from '../components/PageViewer';
import { ReviewTable } from '../components/ReviewTable';
import { StatusBadge } from '../components/StatusBadge';
import { db, deleteExam } from '../lib/db';
import { newKey, type Candidate } from '../lib/extract/parse';
import { locateResults } from '../lib/extract/locate';
import { useItems } from '../lib/hooks';
import { blockingProblems, replaceResults } from '../lib/save';
import { formatValue, judge, rangeText } from '../lib/status';
import { GROUPS, type Loc, type Result } from '../lib/types';

export default function ExamDetail() {
  const id = Number(useParams().id);
  const focusItem = useSearchParams()[0].get('item');
  const scrolled = useRef(false);
  const nav = useNavigate();
  const items = useItems();
  const data = useLiveQuery(async () => {
    const exam = await db.exams.get(id);
    if (!exam) return null;
    const [member, results] = await Promise.all([
      db.members.get(exam.memberId),
      db.results.where('examId').equals(id).toArray(),
    ]);
    return { exam, member, results };
  }, [id]);
  // 원본 이미지는 따로 읽어, 결과(위치 저장 등)가 바뀌어도 이미지가 다시 그려지지 않게 한다
  const files = useLiveQuery(() => db.files.where('examId').equals(id).toArray(), [id]);
  const allPages = useMemo(() => files?.flatMap((f) => f.pages) ?? [], [files]);

  const [selected, setSelected] = useState<string | null>(focusItem);
  const [focus, setFocus] = useState<{ loc: Loc; key: number; label?: string } | null>(null);
  const [locating, setLocating] = useState('');

  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [date, setDate] = useState('');
  const [institution, setInstitution] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  // 대시보드에서 항목을 지정해 들어오면 원본 위치도 바로 보여 준다
  const autoFocused = useRef(false);
  useEffect(() => {
    if (autoFocused.current || !data || !focusItem) return;
    const r = data.results.find((x) => x.itemCode === focusItem);
    if (r?.loc) {
      autoFocused.current = true;
      setFocus({ loc: r.loc, key: Date.now(), label: items.find((d) => d.code === r.itemCode)?.name });
    }
  }, [data, focusItem, items]);

  useEffect(() => {
    if (data?.exam && !editing) {
      setDate(data.exam.date);
      setInstitution(data.exam.institution);
    }
  }, [data, editing]);

  if (data === undefined) return null;
  if (data === null || !data.member)
    return (
      <div className="card stack">
        <p>기록을 찾을 수 없습니다.</p>
        <Link className="btn" to="/records">목록으로</Link>
      </div>
    );

  const { exam, member, results } = data;
  const defs = new Map(items.map((d) => [d.code, d]));
  const order = new Map(items.map((d, i) => [d.code, i]));
  const sorted = [...results].sort((a, b) => (order.get(a.itemCode) ?? 999) - (order.get(b.itemCode) ?? 999));

  const startEdit = () => {
    setRows(
      sorted.map((r) => ({
        key: newKey(),
        rawName: r.rawName ?? defs.get(r.itemCode)?.name ?? r.itemCode,
        rawValue: r.rawValue ?? '',
        itemCode: r.itemCode,
        value: String(r.value),
        unit: r.unit,
        source: 'saved' as const,
        loc: r.loc,
      })),
    );
    setProblems([]);
    setEditing(true);
  };

  const save = async () => {
    const p = blockingProblems(rows, items);
    setProblems(p);
    if (p.length) return;
    await db.exams.update(id, { date, institution: institution.trim() });
    await replaceResults(id, rows, items);
    setEditing(false);
  };

  const remove = async () => {
    if (!confirm(`${exam.date} 검진 기록과 원본 이미지를 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await deleteExam(id);
    nav('/records');
  };

  /** 오른쪽 항목을 누르면 왼쪽 원본에서 그 위치를 찾아 강조 */
  const selectItem = async (r: Result) => {
    setSelected(r.itemCode);
    const label = defs.get(r.itemCode)?.name;
    if (r.loc) {
      setLocating('');
      setFocus({ loc: r.loc, key: Date.now(), label });
      return;
    }
    if (!allPages.length) {
      setLocating(exam.isSample ? '샘플 데이터라 원본이 없습니다.' : '원본 이미지가 없습니다.');
      return;
    }
    setFocus(null);
    setLocating('원본에서 위치를 찾는 중…');
    try {
      const found = await locateResults(allPages, results, items, (msg) => setLocating(msg), r.itemCode);
      const loc = found.get(r.itemCode);
      if (loc) {
        setLocating('');
        setFocus({ loc, key: Date.now(), label });
      } else setLocating(`원본에서 '${label}' 위치를 찾지 못했습니다.`);
    } catch (e) {
      setLocating(`위치를 찾지 못했습니다: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn ghost sm" style={{ marginLeft: -10, marginBottom: 6 }} onClick={() => nav(-1)}><IconChevronLeft />뒤로</button>
          <h1>{member.name} · {exam.date.replace(/-/g, '.')} 검진</h1>
          <div className="sub">{exam.institution || '기관 미입력'}</div>
        </div>
        {!editing && (
          <div className="row">
            <button className="btn" onClick={startEdit}>수정</button>
            <button className="btn danger" onClick={remove}>삭제</button>
          </div>
        )}
      </div>

      <div className="review">
        <div className="card">
          <div className="card-title">
            <h3>원본 다시 보기</h3>
            <span className="small muted">{allPages.length ? `${allPages.length}쪽 · 식별정보 가림` : ''}</span>
          </div>
          {locating && <div className="notice" style={{ margin: '0 0 10px' }}>{locating}</div>}
          {exam.isSample ? <p className="muted small">샘플 데이터라 원본 파일이 없습니다.</p> : <PageViewer pages={allPages} focus={focus} />}
        </div>

        <div className="card stack">
          {editing ? (
            <>
              <div className="form-grid">
                <label className="field"><span>검진일</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                <label className="field"><span>검진 기관</span><input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} /></label>
              </div>
              <ReviewTable rows={rows} onChange={setRows} items={items} sex={member.sex} />
              {problems.length > 0 && (
                <div className="notice bad" style={{ margin: 0 }}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setEditing(false)}>취소</button>
                <button className="btn primary" onClick={save}>저장</button>
              </div>
            </>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>그룹</th><th>항목</th><th className="r">값</th><th>참고 범위</th><th>판정</th></tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const d = defs.get(r.itemCode);
                    if (!d) return null;
                    return (
                      <tr
                        key={r.id}
                        className={`clickable ${r.itemCode === selected ? 'hl' : ''}`}
                        onClick={() => selectItem(r)}
                        title="눌러서 원본 위치 보기"
                        ref={r.itemCode === focusItem ? (el) => { if (el && !scrolled.current) { scrolled.current = true; el.scrollIntoView({ block: 'center' }); } } : undefined}
                      >
                        <td className="small muted">{GROUPS.find((g) => g.key === d.group)?.label}</td>
                        <td>{d.name}</td>
                        <td className="r num"><b>{formatValue(d, r.value)}</b> <span className="small muted">{d.kind === 'grade' ? '' : d.unit}</span></td>
                        <td className="small muted num">{rangeText(d, member.sex)}</td>
                        <td><StatusBadge status={judge(d, r.value, member.sex)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
