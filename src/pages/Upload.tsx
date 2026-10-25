import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MaskEditor } from '../components/MaskEditor';
import { IconFile, IconInfo, IconUpload } from '../components/Icons';
import { Modal } from '../components/Modal';
import { ReviewTable } from '../components/ReviewTable';
import { db, DEFAULT_INSTITUTION, getSetting } from '../lib/db';
import { AI_MODEL, extractWithClaude } from '../lib/extract/ai';
import { maskPage } from '../lib/extract/mask';
import { canvasToBlob, readFilePages } from '../lib/extract/pages';
import { matchItemName, buildAliasIndex, parseLines, type Candidate, type SrcLine } from '../lib/extract/parse';
import { useItems } from '../lib/hooks';
import { useMember } from '../lib/member';
import { fillBmi } from '../lib/review';
import { blockingProblems, replaceResults } from '../lib/save';

type Step = 'form' | 'processing' | 'review';


interface PageImg {
  canvas: HTMLCanvasElement;
  fileName: string;
  url: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** 결과지 본문에서 검진일로 보이는 날짜를 찾는다 */
function findExamDate(lines: string[]): string | null {
  for (const l of lines) {
    if (!/검진일|수검일|검사일|검진\s*일자|실시일/.test(l)) continue;
    const m = l.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return null;
}

function findInstitution(lines: string[]): string | null {
  for (const l of lines) {
    const m = l.match(/검진\s*기관(?:명)?\s*[:：]?\s*([가-힣A-Za-z0-9()]+(?:\s[가-힣A-Za-z0-9()]+)?)/);
    if (m && m[1].length >= 2) return m[1].trim();
  }
  return null;
}

export default function Upload() {
  const nav = useNavigate();
  const items = useItems();
  const { members, member } = useMember();
  const ai = useLiveQuery(async () => ({
    enabled: await getSetting('aiEnabled', false),
    key: await getSetting('apiKey', ''),
  }), []);

  const [step, setStep] = useState<Step>('form');
  const [memberId, setMemberId] = useState<number | undefined>(undefined);
  const [date, setDate] = useState(today());
  const [institution, setInstitution] = useState(DEFAULT_INSTITUTION);
  // 설정에 저장한 기본 검진기관으로 채운다 (업로드할 때마다 바꿀 수 있음)
  const defaultInst = useLiveQuery(() => getSetting('defaultInstitution', DEFAULT_INSTITUTION), []);
  const [instTouched, setInstTouched] = useState(false);
  useEffect(() => {
    if (defaultInst != null && !instTouched) setInstitution(defaultInst);
  }, [defaultInst, instTouched]);
  const [files, setFiles] = useState<File[]>([]);
  const [method, setMethod] = useState<'local' | 'ai'>('local');
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState({ msg: '', ratio: 0 });
  const [pages, setPages] = useState<PageImg[]>([]);
  const [rows, setRows] = useState<Candidate[]>([]);
  const [localRows, setLocalRows] = useState<Candidate[]>([]);
  const [maskedCount, setMaskedCount] = useState(0);
  const [ocrUsed, setOcrUsed] = useState(false);
  const [suggest, setSuggest] = useState<{ date?: string; institution?: string }>({});
  const [consent, setConsent] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [pwAsk, setPwAsk] = useState<{ fileName: string; wrong: boolean; resolve: (pw: string | null) => void } | null>(null);
  const [pw, setPw] = useState('');
  const [formError, setFormError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const askPassword = (fileName: string, wrong: boolean) =>
    new Promise<string | null>((resolve) => {
      setPw('');
      setPwAsk({ fileName, wrong, resolve });
    });
  const answerPassword = (value: string | null) => {
    pwAsk?.resolve(value);
    setPwAsk(null);
    setPw('');
  };

  const mid = memberId ?? member?.id;
  const target = members.find((m) => m.id === mid);
  const aiReady = !!ai?.enabled && !!ai?.key;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const isOk = (f: File) => /pdf|jpe?g|png/i.test(f.type) || /\.(pdf|jpe?g|png)$/i.test(f.name);
    const ok = [...list].filter(isOk);
    const rejected = [...list].filter((f) => !isOk(f));
    setFiles((prev) => [...prev, ...ok]);
    setFormError(
      rejected.length
        ? `${rejected.map((f) => f.name).join(', ')}: 지원하지 않는 형식입니다. PDF·JPG·PNG만 올릴 수 있어요. (아이폰 HEIC 사진은 JPG로 바꿔 주세요)`
        : '',
    );
  };

  const process = async () => {
    setStep('processing');
    setAiError('');
    const imgs: PageImg[] = [];
    const lines: SrcLine[] = [];
    let masked = 0;
    let ocr = false;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const raw = await readFilePages(f, (msg, r) => setProgress({ msg, ratio: (i + (r ?? 0)) / files.length }), askPassword);
        for (const p of raw) {
          masked += maskPage(p);
          if (p.source === 'ocr') ocr = true;
          lines.push(...p.lines.map((l) => ({ text: l.text, boxes: l.boxes, page: imgs.length, width: p.canvas.width, height: p.canvas.height })));
          imgs.push({ canvas: p.canvas, fileName: f.name, url: p.canvas.toDataURL('image/jpeg', 0.7) });
        }
      }
    } catch (e) {
      setFormError(`파일을 읽지 못했습니다. ${(e as Error).message}`);
      setStep('form');
      return;
    }
    const parsed = fillBmi(parseLines(lines, items));
    setPages(imgs);
    setMaskedCount(masked);
    setOcrUsed(ocr);
    setLocalRows(parsed);
    setRows(parsed);
    const d = findExamDate(lines.map((l) => l.text));
    const inst = findInstitution(lines.map((l) => l.text));
    setSuggest({
      date: d && d !== date ? d : undefined,
      institution: inst && inst !== institution.trim() ? inst : undefined,
    });
    setStep('review');
    if (method === 'ai' && aiReady) setConsent(true);
  };

  const runAi = async () => {
    setConsent(false);
    setAiBusy(true);
    setAiError('');
    try {
      const blobs = await Promise.all(pages.map((p) => canvasToBlob(p.canvas)));
      const out = await extractWithClaude(ai!.key, blobs, items);
      // AI가 표준 항목을 못 정했으면 로컬 별칭 사전으로 한 번 더 맞춰 본다
      const index = buildAliasIndex(items);
      // AI 결과에는 위치가 없으니 같은 항목을 로컬 추출에서 찾은 위치를 빌려 쓴다
      const localLoc = new Map(localRows.filter((r) => r.loc).map((r) => [r.itemCode, r.loc]));
      const cands = out.candidates.map((c) => {
        const code = c.itemCode || matchItemName(c.rawName, index);
        return { ...c, itemCode: code, loc: localLoc.get(code) };
      });
      setRows(fillBmi(cands));
      setSuggest({
        date: out.examDate && out.examDate !== date ? out.examDate : suggest.date,
        institution: out.institution && out.institution !== institution ? out.institution : undefined,
      });
    } catch (e) {
      setAiError(`${(e as Error).message} 로컬 추출 결과를 그대로 보여 드립니다.`);
      setRows(localRows);
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!target) return;
    const p = blockingProblems(rows, items);
    setProblems(p);
    if (p.length) return;
    const dup = await db.exams.where('memberId').equals(target.id!).filter((e) => e.date === date).count();
    if (dup && !confirm(`${target.name}님의 ${date} 검진 기록이 이미 있습니다. 별도 기록으로 하나 더 저장할까요?`)) return;

    const examId = (await db.exams.add({ memberId: target.id!, date, institution: institution.trim(), createdAt: Date.now() })) as number;
    await replaceResults(examId, rows, items);
    const byFile = new Map<string, HTMLCanvasElement[]>();
    pages.forEach((p) => byFile.set(p.fileName, [...(byFile.get(p.fileName) ?? []), p.canvas]));
    for (const [name, canvases] of byFile) {
      await db.files.add({ examId, name, pages: await Promise.all(canvases.map((c) => canvasToBlob(c))), maskedCount });
    }
    nav(`/records/${examId}`);
  };

  const reset = () => {
    setStep('form');
    setPages([]);
    setRows([]);
    setFiles([]);
    setProblems([]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">UPLOAD</div>
          <h1>검진 결과 올리기</h1>
          <div className="sub">PDF · JPG · PNG 파일에서 수치를 읽고, 확인한 뒤 저장합니다</div>
        </div>
      </div>

      <div className="steps" aria-label="진행 단계">
        <span className={`step ${step === 'form' ? 'on' : ''}`}><span className="n">1</span>파일 선택</span>
        <span className={`step ${step === 'processing' ? 'on' : ''}`}><span className="n">2</span>추출</span>
        <span className={`step ${step === 'review' ? 'on' : ''}`}><span className="n">3</span>검토 후 저장</span>
      </div>

      {step === 'form' && (
        <div className="card stack">
          {members.length === 0 ? (
            <p>먼저 <Link to="/settings">설정</Link>에서 가족 구성원을 추가해 주세요.</p>
          ) : (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>구성원</span>
                  <select className="input" value={mid} onChange={(e) => setMemberId(Number(e.target.value))}>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>검진일</span>
                  <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="field">
                  <span>검진 기관</span>
                  <input className="input" value={institution} onChange={(e) => { setInstTouched(true); setInstitution(e.target.value); }} placeholder="예: ○○병원 건강검진센터" />
                </label>
              </div>

              <div
                className={`drop ${over ? 'over' : ''}`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              >
                <div className="drop-ico"><IconUpload /></div>
                <div style={{ fontWeight: 650, color: 'var(--ink)' }}>파일을 끌어다 놓거나 눌러서 선택</div>
                <div className="small muted">PDF, JPG, PNG · 여러 장 스캔본은 한꺼번에 선택하세요</div>
                <input ref={inputRef} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {files.length > 0 && (
                <ul className="file-list">
                  {files.map((f, i) => (
                    <li key={i}>
                      <span style={{ width: 18, height: 18, display: 'inline-flex', color: 'var(--primary)' }}><IconFile /></span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span className="small muted">{Math.round(f.size / 1024)}KB</span>
                      <button className="btn ghost sm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>빼기</button>
                    </li>
                  ))}
                </ul>
              )}

              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field" style={{ marginBottom: 8 }}><span>추출 방법</span></legend>
                <div className="method">
                <label className={method === 'local' ? 'on' : ''}>
                  <input type="radio" checked={method === 'local'} onChange={() => setMethod('local')} />
                  <span><b>이 기기에서 추출</b> <span className="badge none" style={{ marginLeft: 4 }}>기본</span><br /><span className="small muted">파일이 밖으로 나가지 않습니다. 스캔본은 정확도가 낮을 수 있어요.</span></span>
                </label>
                <label className={method === 'ai' ? 'on' : aiReady ? '' : 'off'}>
                  <input type="radio" disabled={!aiReady} checked={method === 'ai'} onChange={() => setMethod('ai')} />
                  <span>
                    <b>AI로 추출 (Claude)</b><br />
                    <span className="small muted">
                      식별정보를 가린 페이지 이미지를 Anthropic 서버로 보냅니다. 보내기 전에 한 번 더 확인을 받습니다.
                      {!aiReady && <> <Link to="/settings">설정</Link>에서 먼저 켜 주세요.</>}
                    </span>
                  </span>
                </label>
                </div>
              </fieldset>

              {formError && <div className="notice bad" style={{ margin: 0 }}>{formError}</div>}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn primary" disabled={!files.length || !target || !date} onClick={process}>추출 시작</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'processing' && (
        <div className="card stack">
          <h2>파일을 읽고 있어요</h2>
          <div className="progress"><div style={{ width: `${Math.round(progress.ratio * 100)}%` }} /></div>
          <p className="small muted">{progress.msg || '준비 중…'}</p>
          <p className="small muted">모든 처리는 이 기기의 브라우저 안에서 이뤄집니다.</p>
        </div>
      )}

      {step === 'review' && target && (
        <>
          <div className="notice">
            <IconInfo />
            <span>
              자동 추출은 틀릴 수 있어요. 왼쪽 원본과 비교해 값을 확인·수정한 뒤 저장해 주세요.
              {maskedCount > 0 && <> 주민등록번호 등 식별정보로 보이는 {maskedCount}곳을 가렸습니다.</>}
              {ocrUsed && method === 'local' && <> 스캔 이미지는 글자 인식 정확도가 낮아 특히 꼼꼼히 확인이 필요합니다.</>}
            </span>
          </div>
          {aiError && <div className="notice bad">{aiError}</div>}
          {(suggest.date || suggest.institution) && (
            <div className="notice warn">
              <span>
                결과지에서 {suggest.date && <>검진일 <b>{suggest.date}</b></>}{suggest.date && suggest.institution && ', '}
                {suggest.institution && <>기관 <b>{suggest.institution}</b></>}을(를) 찾았어요.
              </span>
              <button
                className="btn sm"
                onClick={() => {
                  if (suggest.date) setDate(suggest.date);
                  if (suggest.institution) setInstitution(suggest.institution);
                  setSuggest({});
                }}
              >
                적용
              </button>
            </div>
          )}

          <div className="review">
            <div className="card">
              <div className="card-title">
                <h3>원본 (가림 처리됨)</h3>
                <span className="small muted">{pages.length}쪽</span>
              </div>
              <div className="pages">
                {pages.map((p, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={p.url} alt={`${p.fileName} ${i + 1}쪽`} onClick={() => setEditing(i)} />
                    <button className="btn sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => setEditing(i)}>직접 가리기</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="card stack">
              <div className="form-grid">
                <label className="field"><span>구성원</span><input className="input" value={target.name} disabled /></label>
                <label className="field"><span>검진일</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                <label className="field"><span>검진 기관</span><input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} /></label>
              </div>
              <div className="row">
                <h3>추출 결과 {rows.filter((r) => r.itemCode).length}개 항목</h3>
                <span className="spacer" />
                {aiReady && (
                  <button className="btn sm" disabled={aiBusy} onClick={() => setConsent(true)}>
                    {aiBusy ? 'AI 추출 중…' : 'AI로 다시 추출'}
                  </button>
                )}
              </div>
              {aiBusy ? (
                <div className="stack">
                  <div className="progress indeterminate"><div /></div>
                  <p className="small muted">Claude가 결과지를 읽고 있어요. 1분 정도 걸릴 수 있습니다.</p>
                </div>
              ) : rows.length === 0 ? (
                <p className="muted">찾은 항목이 없습니다. 아래에서 직접 입력하거나, 설정에서 AI 추출을 켜고 다시 시도해 보세요.</p>
              ) : null}
              {!aiBusy && <ReviewTable rows={rows} onChange={setRows} items={items} sex={target.sex} />}
              {problems.length > 0 && (
                <div className="notice bad" style={{ margin: 0 }}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={reset}>취소</button>
                <button className="btn primary" disabled={aiBusy} onClick={save}>확인했어요, 저장</button>
              </div>
            </div>
          </div>
        </>
      )}

      {editing != null && pages[editing] && (
        <MaskEditor
          canvas={pages[editing].canvas}
          onDone={(changed) => {
            if (changed) {
              setPages(pages.map((p, i) => (i === editing ? { ...p, url: p.canvas.toDataURL('image/jpeg', 0.7) } : p)));
            }
            setEditing(null);
          }}
        />
      )}

      {pwAsk && (
        <Modal title="PDF 비밀번호 입력" onClose={() => answerPassword(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (pw) answerPassword(pw);
            }}
          >
            <p className="small">
              <b>{pwAsk.fileName}</b> 파일에 비밀번호가 걸려 있습니다. 결과지를 내려받을 때 정한 비밀번호를 입력해 주세요.
              (공단·병원 결과지는 보통 생년월일 6자리 등을 씁니다)
            </p>
            {pwAsk.wrong && <div className="notice bad" style={{ margin: 0 }}>비밀번호가 맞지 않습니다. 다시 입력해 주세요.</div>}
            <input className="input" type="password" autoFocus autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
            <p className="small muted">비밀번호는 파일을 여는 데만 쓰고 저장하지 않습니다.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => answerPassword(null)}>취소</button>
              <button type="submit" className="btn primary" disabled={!pw}>열기</button>
            </div>
          </form>
        </Modal>
      )}

      {consent && (
        <Modal title="외부 AI로 파일 보내기 확인" onClose={() => setConsent(false)}>
          <p>AI 추출을 위해 다음 내용을 외부 서버로 보냅니다.</p>
          <ul className="small">
            <li><b>받는 곳:</b> Anthropic (Claude API, 모델 {AI_MODEL}) · 미국 등 해외 서버</li>
            <li><b>보내는 것:</b> 식별정보를 가린 페이지 이미지 {Math.min(pages.length, 20)}장. 원본 파일, 구성원 이름, 다른 기록은 보내지 않습니다.</li>
            <li><b>남아 있을 수 있는 정보:</b> 자동으로는 주민등록번호·전화번호만 가립니다. 이름·주소가 보이면 취소하고 ‘직접 가리기’로 덮은 뒤 다시 시도하세요.</li>
            <li><b>비용:</b> 설정에 등록한 본인 API 키로 호출되며, 사용량에 따라 요금이 청구됩니다.</li>
            <li>보낸 데이터는 Anthropic의 API 데이터 처리 정책에 따라 처리됩니다.</li>
          </ul>
          <div className="row" style={{ gap: 6, overflowX: 'auto', margin: '10px 0' }}>
            {pages.slice(0, 6).map((p, i) => (
              <img key={i} src={p.url} alt="" style={{ height: 90, border: '1px solid var(--line)', borderRadius: 4 }} />
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConsent(false)}>보내지 않음</button>
            <button className="btn primary" onClick={runAi}>동의하고 보내기</button>
          </div>
        </Modal>
      )}
    </>
  );
}
