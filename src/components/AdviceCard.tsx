import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildPayload, hashPayload, loadAdvice, requestAdvice, type Advice } from '../lib/advice';
import { getSetting } from '../lib/db';
import { AI_MODEL } from '../lib/extract/ai';
import type { Point } from '../lib/status';
import type { Exam, ItemDef, Member } from '../lib/types';
import { IconSparkle } from './Icons';
import { Modal } from './Modal';

const LEVEL: Record<Advice['points'][number]['level'], { label: string; cls: string }> = {
  good: { label: '좋음·안정', cls: 'normal' },
  watch: { label: '지켜보기', cls: 'caution' },
  consult: { label: '상담 권장', cls: 'abnormal' },
};

interface Props {
  member: Member;
  exams: Exam[];
  items: ItemDef[];
  series: Map<string, Point[]>;
}

export function AdviceCard({ member, exams, items, series }: Props) {
  const ai = useLiveQuery(async () => ({ enabled: await getSetting('aiEnabled', false), key: await getSetting('apiKey', '') }), []);
  const saved = useLiveQuery(() => loadAdvice(member.id!), [member.id]);
  const payload = useMemo(() => buildPayload(member, exams, items, series), [member, exams, items, series]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const aiReady = !!ai?.enabled && !!ai?.key;
  const stale = !!saved && saved.hash !== hashPayload(payload);

  const run = async () => {
    setConsent(false);
    setBusy(true);
    setError('');
    try {
      await requestAdvice(ai!.key, member.id!, payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card advice-card">
      <div className="card-title">
        <div className="row" style={{ gap: 10 }}>
          <span className="advice-ico"><IconSparkle /></span>
          <div>
            <h2>AI 건강 코멘트</h2>
            <div className="small muted">
              {saved ? `${new Date(saved.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })} 생성` : '검진 추이를 바탕으로 한 참고용 해설'}
              {stale && ' · 이후 기록이 바뀌었어요'}
            </div>
          </div>
        </div>
        {aiReady ? (
          <button className="btn sm primary" disabled={busy} onClick={() => setConsent(true)}>
            {busy ? '분석 중…' : saved ? '다시 받기' : 'AI 조언 받기'}
          </button>
        ) : (
          <Link className="btn sm" to="/settings">설정에서 AI 켜기</Link>
        )}
      </div>

      {busy && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="progress indeterminate"><div /></div>
          <p className="small muted">Claude가 {exams.length}회 검진 추이를 살펴보고 있어요. 30초~1분 정도 걸릴 수 있습니다.</p>
        </div>
      )}
      {error && <div className="notice bad" style={{ margin: 0 }}>{error}</div>}

      {!busy && !saved && !error && (
        <p className="muted small">
          {aiReady
            ? '버튼을 누르면 보낼 내용을 먼저 보여 드리고, 동의하시면 연도별 수치를 분석해 눈여겨볼 점과 생활 습관 팁을 정리해 드립니다.'
            : 'AI 조언은 설정에서 AI 기능과 Anthropic API 키를 등록하면 쓸 수 있어요. 수치는 동의한 경우에만 외부로 전송됩니다.'}
        </p>
      )}

      {!busy && saved && (
        <div className="advice-body">
          <p className="advice-summary">{saved.advice.summary}</p>
          <div className="advice-points">
            {saved.advice.points.map((p, i) => (
              <div key={i} className={`advice-point ${p.level}`}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                  <b>{p.title}</b>
                  <span className={`badge ${LEVEL[p.level].cls}`}>{LEVEL[p.level].label}</span>
                </div>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
          <div className="advice-cols">
            <div>
              <h3>생활 습관 팁</h3>
              <ul>{saved.advice.habits.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </div>
            <div>
              <h3>진료 때 물어볼 것</h3>
              <ul>{saved.advice.askDoctor.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </div>
          </div>
          <p className="small muted">AI가 만든 일반적인 참고 해설이며 진단이나 처방이 아닙니다. 건강 판단은 의료진과 상담해 주세요.</p>
        </div>
      )}

      {consent && (
        <Modal title="AI에 검진 수치 보내기 확인" onClose={() => setConsent(false)} wide>
          <ul className="small">
            <li><b>받는 곳:</b> Anthropic (Claude API, 모델 {AI_MODEL}) · 해외 서버</li>
            <li><b>보내는 것:</b> 아래 내용 그대로입니다. 이름·검진기관·원본 이미지는 보내지 않고, 나이는 연령대로만 보냅니다.</li>
            <li><b>비용:</b> 등록한 본인 API 키로 호출되어 사용량만큼 요금이 청구됩니다.</li>
          </ul>
          <pre className="payload">{payload}</pre>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setConsent(false)}>보내지 않음</button>
            <button className="btn primary" onClick={run}>동의하고 분석 받기</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
