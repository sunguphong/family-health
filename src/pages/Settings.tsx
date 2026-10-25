import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { NewItemModal } from '../components/ReviewTable';
import { db, DEFAULT_INSTITUTION, deleteMember, getSetting, setSetting } from '../lib/db';
import { AI_MODEL, testApiKey } from '../lib/extract/ai';
import { exportBackup, importBackup } from '../lib/export';
import { useItems } from '../lib/hooks';
import { DEFAULT_ITEMS } from '../lib/items';
import { hasSampleData, loadSampleData, removeSampleData } from '../lib/sample';
import { rangeText } from '../lib/status';
import { cloudEnabled } from '../config';
import { replaceRemoteWithLocal, signOutAndWipe, supabase, syncNow, useSyncStatus, wipeRemote } from '../lib/cloud/sync';
import { GROUPS, type ItemDef, type Member, type Range, type RangeSet, type Sex } from '../lib/types';

export default function Settings() {
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">SETTINGS</div><h1>설정</h1></div></div>
      <div className="stack">
        {cloudEnabled && <AccountSection />}
        <MembersSection />
        <UploadDefaultsSection />
        <AiSection />
        <ItemsSection />
        <DataSection />
      </div>
    </>
  );
}

/* ---------------- 계정·동기화 ---------------- */
function AccountSection() {
  const s = useSyncStatus();
  const [email, setEmail] = useState('');
  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);
  return (
    <section className="card">
      <div className="card-title"><h2>계정 · 동기화</h2></div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row">
          <span className="badge none">{email || '로그인됨'}</span>
          <span className="small muted">
            {s.state === 'syncing' ? s.message ?? '동기화 중…'
              : s.state === 'error' ? `오류: ${s.message}`
              : s.state === 'offline' ? '오프라인'
              : s.lastSyncAt ? `마지막 동기화 ${new Date(s.lastSyncAt).toLocaleString('ko-KR')}` : '연결됨'}
          </span>
        </div>
        <p className="small muted">
          기록은 이 기기에서 데이터 비밀번호로 암호화된 뒤 서버(Supabase)에 저장되고, 같은 계정으로 로그인한 기기끼리 자동으로 맞춰집니다.
          데이터 비밀번호는 서버에 저장되지 않으니 잊어버리지 않게 보관하세요.
        </p>
        <div className="row">
          <button className="btn" disabled={s.state === 'syncing'} onClick={() => syncNow().catch(() => {})}>지금 동기화</button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('로그아웃하면 이 기기에 남은 사본을 지웁니다. 서버의 기록은 그대로 남아 다시 로그인하면 불러옵니다. 계속할까요?')) signOutAndWipe();
            }}
          >
            로그아웃
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------------- 구성원 ---------------- */
function MembersSection() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? [];
  const [edit, setEdit] = useState<Member | null>(null);
  return (
    <section className="card">
      <div className="card-title">
        <h2>가족 구성원</h2>
        <button className="btn sm primary" onClick={() => setEdit({ name: '', sex: 'M' })}>＋ 추가</button>
      </div>
      <p className="small muted" style={{ marginBottom: 8 }}>성별은 혈색소·허리둘레·감마GTP처럼 남녀 기준이 다른 항목의 판정에 쓰입니다.</p>
      {members.length === 0 && <p className="muted">구성원이 없습니다.</p>}
      {members.map((m) => (
        <div key={m.id} className="list-row">
          <div style={{ flex: 1 }}>
            <b>{m.name}</b>{' '}
            <span className="small muted">{m.sex === 'M' ? '남' : '여'}{m.birthYear ? ` · ${m.birthYear}년생` : ''}{m.isSample ? ' · 샘플' : ''}</span>
          </div>
          <button className="btn sm" onClick={() => setEdit(m)}>수정</button>
          <button
            className="btn sm danger"
            onClick={async () => {
              const n = await db.exams.where('memberId').equals(m.id!).count();
              if (confirm(`${m.name}님과 검진 기록 ${n}건을 모두 삭제할까요? 되돌릴 수 없습니다.`)) await deleteMember(m.id!);
            }}
          >
            삭제
          </button>
        </div>
      ))}
      {edit && <MemberModal member={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function MemberModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const [name, setName] = useState(member.name);
  const [sex, setSex] = useState<Sex>(member.sex);
  const [birthYear, setBirthYear] = useState(member.birthYear ? String(member.birthYear) : '');
  const save = async () => {
    const v = { name: name.trim(), sex, birthYear: birthYear ? Number(birthYear) : undefined };
    if (member.id) await db.members.update(member.id, v);
    else await db.members.add(v);
    onClose();
  };
  return (
    <Modal title={member.id ? '구성원 수정' : '구성원 추가'} onClose={onClose}>
      <div className="form-grid">
        <label className="field"><span>이름(호칭)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 나, 엄마" /></label>
        <label className="field">
          <span>성별</span>
          <select className="input" value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
            <option value="M">남</option>
            <option value="F">여</option>
          </select>
        </label>
        <label className="field"><span>출생 연도 (선택)</span><input className="input" inputMode="numeric" value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="예: 1980" /></label>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>실명 대신 호칭을 써도 됩니다. 생년월일 전체나 주민등록번호는 저장하지 않습니다.</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>저장</button>
      </div>
    </Modal>
  );
}

/* ---------------- 업로드 기본값 ---------------- */
function UploadDefaultsSection() {
  const saved = useLiveQuery(() => getSetting('defaultInstitution', DEFAULT_INSTITUTION), []);
  const [value, setValue] = useState<string | null>(null);
  const v = value ?? saved ?? '';
  const dirty = value != null && value.trim() !== saved;
  return (
    <section className="card">
      <div className="card-title"><h2>업로드 기본값</h2></div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>
          <span>기본 검진기관</span>
          <input className="input" value={v} onChange={(e) => setValue(e.target.value)} placeholder="비워 두면 매번 직접 입력" />
        </label>
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={async () => {
            await setSetting('defaultInstitution', v.trim());
            setValue(null);
          }}
        >
          저장
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>검진 결과 올리기 화면에 미리 채워지며, 올릴 때마다 바꿀 수 있습니다.</p>
    </section>
  );
}

/* ---------------- AI ---------------- */
function AiSection() {
  const [enabled, setEnabled] = useState(false);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmOn, setConfirmOn] = useState(false);

  useEffect(() => {
    (async () => {
      setEnabled(await getSetting('aiEnabled', false));
      setKey(await getSetting('apiKey', ''));
    })();
  }, []);

  const toggle = async (v: boolean) => {
    if (v) return setConfirmOn(true);
    setEnabled(false);
    await setSetting('aiEnabled', false);
  };

  return (
    <section className="card">
      <div className="card-title"><h2>AI 추출 (선택)</h2></div>
      <div className="stack">
        <p className="small">
          스캔본처럼 이 기기에서 읽기 어려운 파일을 Claude(Anthropic)로 읽을 수 있습니다. <b>기본은 꺼져 있고</b>, 켜더라도 매번
          보내기 전에 어떤 이미지가 어디로 가는지 보여 주고 동의를 받습니다.
        </p>
        <label className="row">
          <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
          <b>AI 추출 사용</b>
        </label>
        <label className="field">
          <span>Anthropic API 키</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              className="input"
              type={show ? 'text' : 'password'}
              value={key}
              autoComplete="off"
              placeholder="sk-ant-…"
              onChange={(e) => setKey(e.target.value.trim())}
              onBlur={() => setSetting('apiKey', key)}
            />
            <button className="btn sm" onClick={() => setShow(!show)}>{show ? '숨기기' : '보기'}</button>
          </div>
        </label>
        <p className="small muted">
          키는 이 기기의 브라우저 저장소에만 보관되고 Anthropic 외의 곳으로는 보내지 않습니다. 사용 모델: {AI_MODEL}. 요금은 키 소유자에게 청구됩니다.
          키는 console.anthropic.com에서 발급받을 수 있어요.
        </p>
        <div className="row">
          <button
            className="btn sm"
            disabled={!key}
            onClick={async () => {
              await setSetting('apiKey', key);
              setMsg('확인 중…');
              try {
                await testApiKey(key);
                setMsg('✓ 연결되었습니다.');
              } catch (e) {
                setMsg(`연결 실패: ${(e as Error).message}`);
              }
            }}
          >
            키 확인 (Anthropic에 짧은 요청을 보냅니다)
          </button>
          <button className="btn sm danger" disabled={!key} onClick={async () => { setKey(''); await setSetting('apiKey', ''); setMsg('키를 지웠습니다.'); }}>키 지우기</button>
          <span className="small muted">{msg}</span>
        </div>
      </div>
      {confirmOn && (
        <Modal title="AI 추출을 켤까요?" onClose={() => setConfirmOn(false)}>
          <ul className="small">
            <li>AI 추출을 고른 업로드에 한해, 식별정보를 가린 결과지 이미지가 Anthropic 서버(해외)로 전송됩니다.</li>
            <li>매 전송 전에 이미지를 미리 보여 주고 다시 동의를 받습니다. 동의하지 않으면 아무것도 보내지 않습니다.</li>
            <li>저장된 다른 기록, 구성원 정보는 보내지 않습니다.</li>
          </ul>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setConfirmOn(false)}>취소</button>
            <button className="btn primary" onClick={async () => { setEnabled(true); await setSetting('aiEnabled', true); setConfirmOn(false); }}>켜기</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ---------------- 항목 ---------------- */
function ItemsSection() {
  const items = useItems();
  const [edit, setEdit] = useState<ItemDef | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <div className="card-title">
        <h2>검사 항목 · 참고 기준</h2>
        <div className="row">
          <button className="btn sm" onClick={() => setOpen(!open)}>{open ? '접기' : `펼치기 (${items.length}개)`}</button>
          <button className="btn sm primary" onClick={() => setAdding(true)}>＋ 항목 추가</button>
        </div>
      </div>
      <p className="small muted">
        기본 기준은 국민건강보험공단 일반건강검진 판정 기준을 바탕으로 한 일반적인 참고값입니다. 다니는 병원 기준에 맞게 바꿀 수 있어요.
        ‘별칭’은 기관마다 다른 항목명을 같은 항목으로 묶는 데 쓰입니다.
      </p>
      {open && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data">
            <thead><tr><th>그룹</th><th>항목</th><th>단위</th><th>정상(남)</th><th>정상(여)</th><th>별칭</th><th /></tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.code}>
                  <td className="small muted">{GROUPS.find((g) => g.key === d.group)?.label}</td>
                  <td>{d.name}{d.custom && <span className="small muted"> (추가)</span>}</td>
                  <td className="small">{d.unit}</td>
                  <td className="small num">{rangeText(d, 'M')}</td>
                  <td className="small num">{rangeText(d, 'F')}</td>
                  <td className="small muted" style={{ maxWidth: 240 }}>{d.aliases.slice(0, 6).join(', ')}{d.aliases.length > 6 ? ' …' : ''}</td>
                  <td><button className="btn sm" onClick={() => setEdit(d)}>편집</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn sm"
            onClick={async () => {
              if (!confirm('기본 항목의 이름·기준·별칭을 처음 값으로 되돌릴까요? (직접 추가한 항목과 기록은 그대로)')) return;
              await db.items.bulkPut(DEFAULT_ITEMS);
            }}
          >
            기본 기준으로 되돌리기
          </button>
        </div>
      )}
      {edit && <ItemModal def={edit} onClose={() => setEdit(null)} />}
      {adding && <NewItemModal rawName="" unit="" count={items.length} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />}
    </section>
  );
}

const rs = (r?: Range) => ({ min: r?.min != null ? String(r.min) : '', max: r?.max != null ? String(r.max) : '' });
const toRange = (v: { min: string; max: string }): Range | undefined => {
  const min = v.min.trim() === '' ? undefined : Number(v.min);
  const max = v.max.trim() === '' ? undefined : Number(v.max);
  return min == null && max == null ? undefined : { min, max };
};

function ItemModal({ def, onClose }: { def: ItemDef; onClose: () => void }) {
  const [name, setName] = useState(def.name);
  const [unit, setUnit] = useState(def.unit);
  const [aliases, setAliases] = useState(def.aliases.join(', '));
  const [r, setR] = useState({
    M: { n: rs(def.ranges?.M.normal), c: rs(def.ranges?.M.caution) },
    F: { n: rs(def.ranges?.F.normal), c: rs(def.ranges?.F.caution) },
  });

  const save = async () => {
    const mk = (s: Sex): RangeSet | undefined => {
      const normal = toRange(r[s].n);
      return normal ? { normal, caution: toRange(r[s].c) } : undefined;
    };
    const M = mk('M');
    const F = mk('F');
    await db.items.update(def.code, {
      name: name.trim() || def.name,
      unit: unit.trim(),
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
      ranges: M && F ? { M, F } : M ? { M, F: M } : F ? { M: F, F } : undefined,
    });
    onClose();
  };

  const remove = async () => {
    const n = await db.results.where('itemCode').equals(def.code).count();
    if (!confirm(`'${def.name}' 항목을 삭제할까요?${n ? ` 이 항목의 기록 ${n}건도 함께 삭제됩니다.` : ''}`)) return;
    await db.results.where('itemCode').equals(def.code).delete();
    await db.items.delete(def.code);
    onClose();
  };

  const rangeInputs = (s: Sex, k: 'n' | 'c', label: string) => (
    <div className="field" key={s + k}>
      <span>{label}</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="input sm num" inputMode="decimal" placeholder="최소" value={r[s][k].min}
          onChange={(e) => setR({ ...r, [s]: { ...r[s], [k]: { ...r[s][k], min: e.target.value } } })} />
        <span>~</span>
        <input className="input sm num" inputMode="decimal" placeholder="최대" value={r[s][k].max}
          onChange={(e) => setR({ ...r, [s]: { ...r[s], [k]: { ...r[s][k], max: e.target.value } } })} />
      </div>
    </div>
  );

  return (
    <Modal title={`${def.name} 편집`} onClose={onClose} wide>
      <div className="form-grid">
        <label className="field"><span>항목명</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>단위</span><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={def.kind === 'grade'} /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>별칭 (쉼표로 구분)</span>
        <textarea className="input" rows={2} value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </label>
      {def.kind === 'grade' ? (
        <p className="small muted" style={{ marginTop: 12 }}>단계형 항목입니다: 음성=정상, 약양성=주의, 양성(+1 이상)=이상.</p>
      ) : (
        <>
          <h3 style={{ marginTop: 16 }}>참고 기준</h3>
          <p className="small muted">정상 범위 밖이지만 ‘주의 범위’ 안이면 주의, 그 밖은 이상으로 표시합니다. 비워 두면 그 방향은 제한이 없습니다.</p>
          <div className="form-grid" style={{ marginTop: 8 }}>
            {rangeInputs('M', 'n', '남 · 정상 범위')}
            {rangeInputs('M', 'c', '남 · 주의 범위')}
            {rangeInputs('F', 'n', '여 · 정상 범위')}
            {rangeInputs('F', 'c', '여 · 주의 범위')}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        {def.custom && <button className="btn danger" onClick={remove}>항목 삭제</button>}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" onClick={save}>저장</button>
      </div>
    </Modal>
  );
}

/* ---------------- 데이터 ---------------- */
function DataSection() {
  const sample = useLiveQuery(() => hasSampleData(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  return (
    <section className="card">
      <div className="card-title"><h2>데이터 관리</h2></div>
      <div className="stack">
        <div className="row">
          {sample ? (
            <button className="btn" onClick={async () => { if (confirm('샘플 구성원과 샘플 기록을 지울까요?')) await removeSampleData(); }}>샘플 데이터 지우기</button>
          ) : (
            <button className="btn" onClick={() => loadSampleData()}>샘플 데이터 불러오기</button>
          )}
          <span className="small muted">가상의 구성원 2명, 2022~2025년 4년치 기록</span>
        </div>
        <div className="row">
          <button className="btn" onClick={() => exportBackup()}>백업 파일 저장</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>백업에서 복원</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f || !confirm('지금 기기의 모든 기록을 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
              try {
                await importBackup(f);
                if (cloudEnabled) {
                  setMsg('복원했습니다. 서버에도 반영하는 중…');
                  await replaceRemoteWithLocal();
                }
                setMsg('복원했습니다.');
              } catch (err) {
                setMsg(`복원 실패: ${(err as Error).message}`);
              }
            }}
          />
          <span className="small muted">{msg || '다른 기기로 옮기거나 브라우저 데이터를 지우기 전에 백업하세요. 백업 파일에는 건강정보가 들어 있으니 보관에 주의하세요.'}</span>
        </div>
        <div className="row">
          <button
            className="btn danger"
            onClick={async () => {
              const where = cloudEnabled ? '서버와 이 기기에서' : '이 기기에서';
              if (!confirm(`모든 구성원, 검진 기록, 원본 이미지, 설정(API 키 포함)을 ${where} 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
              if (cloudEnabled) {
                try {
                  await wipeRemote();
                } catch (err) {
                  alert(`서버 기록을 지우지 못했습니다: ${(err as Error).message}`);
                  return;
                }
              }
              await db.delete();
              try {
                localStorage.setItem('noSampleSeed', '1');
              } catch {
                /* 저장 못 하면 다음 실행 때 샘플이 다시 들어갈 뿐 */
              }
              location.reload();
            }}
          >
            전체 데이터 삭제
          </button>
        </div>
      </div>
    </section>
  );
}
