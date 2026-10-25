import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { cloudEnabled } from '../config';
import { createVault, getVault, initialSync, setSessionUser, signOutAndWipe, startAutoSync, supabase, tryRememberedKey, unlock } from '../lib/cloud/sync';
import { IconPulse, IconShield } from './Icons';

type Phase = 'loading' | 'login' | 'create-pass' | 'enter-pass' | 'syncing' | 'ready';

/** 서버 저장 모드에서는 로그인 → 데이터 비밀번호 → 첫 동기화를 거쳐야 앱이 열린다 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(cloudEnabled ? 'loading' : 'ready');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  const afterLogin = async (uid: string, mail: string) => {
    setSessionUser(uid);
    setEmail(mail);
    try {
      if (await tryRememberedKey()) return await finish();
      setPhase((await getVault()) ? 'enter-pass' : 'create-pass');
    } catch (e) {
      setMsg((e as Error).message);
      setPhase('enter-pass');
    }
  };

  const finish = async () => {
    setPhase('syncing');
    try {
      await initialSync(setMsg);
      setMsg('');
    } catch (e) {
      // 서버에 못 닿아도 이 기기의 사본으로는 쓸 수 있게 연다
      setMsg(`동기화하지 못했습니다: ${(e as Error).message}`);
    }
    startAutoSync();
    setPhase('ready');
  };

  useEffect(() => {
    if (!cloudEnabled) return;
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        const u = data.session?.user;
        if (u) afterLogin(u.id, u.email ?? '');
        else setPhase('login');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'ready') return <>{children}</>;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand" style={{ padding: '0 0 22px' }}>
          <span className="brand-mark"><IconPulse /></span>
          <span>우리집 건강검진<small>Family Health Record</small></span>
        </div>
        {phase === 'loading' && <p className="muted">불러오는 중…</p>}
        {phase === 'login' && <LoginForm onDone={(u, m) => afterLogin(u, m)} />}
        {(phase === 'create-pass' || phase === 'enter-pass') && (
          <PassForm
            create={phase === 'create-pass'}
            email={email}
            error={msg}
            onDone={finish}
          />
        )}
        {phase === 'syncing' && (
          <div className="stack">
            <h2>기록을 불러오는 중</h2>
            <div className="progress indeterminate"><div /></div>
            <p className="small muted">{msg || '서버와 동기화하는 중…'}</p>
          </div>
        )}
      </div>
      <p className="auth-foot">
        <IconShield />기록은 이 기기에서 암호화한 뒤 서버에 저장됩니다. 서버에서는 내용을 볼 수 없습니다.
      </p>
    </div>
  );
}

/** 로그인만 제공. 계정은 관리자가 Supabase 관리 화면에서 만들고, 서버 설정으로 가입도 막아 둔다 */
function LoginForm({ onDone }: { onDone: (userId: string, email: string) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const { data, error } = await supabase().auth.signInWithPassword({ email, password: pw });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 맞지 않습니다.' : error.message);
      onDone(data.user.id, data.user.email ?? email);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div>
        <h2>로그인</h2>
        <p className="small muted" style={{ marginTop: 4 }}>어느 컴퓨터·휴대폰에서든 같은 계정으로 로그인하면 기록이 이어집니다.</p>
      </div>
      <label className="field"><span>이메일</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field">
        <span>로그인 비밀번호</span>
        <input className="input" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      {msg && <div className="notice warn" style={{ margin: 0 }}>{msg}</div>}
      <button className="btn primary" disabled={busy}>{busy ? '확인 중…' : '로그인'}</button>
      <p className="small muted" style={{ textAlign: 'center' }}>계정 발급·비밀번호 초기화는 관리자에게 요청해 주세요.</p>
    </form>
  );
}

function PassForm({ create, email, error, onDone }: { create: boolean; email: string; error: string; onDone: () => void }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(error);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (create && p1 !== p2) return setMsg('두 비밀번호가 다릅니다.');
    setBusy(true);
    try {
      if (create) {
        await createVault(p1, remember);
        onDone();
      } else if (await unlock(p1, remember)) onDone();
      else setMsg('데이터 비밀번호가 맞지 않습니다.');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div>
        <h2>{create ? '데이터 비밀번호 만들기' : '데이터 비밀번호 입력'}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>{email} 계정</p>
      </div>
      {create ? (
        <div className="notice warn" style={{ margin: 0 }}>
          기록을 암호화하는 비밀번호입니다. 로그인 비밀번호와 다르게 정하세요. <b>잊어버리면 누구도 기록을 복구할 수 없으니</b> 안전한 곳에 적어 두세요.
        </div>
      ) : (
        <p className="small muted">이 기기에서 처음 열 때 한 번 입력하면 됩니다.</p>
      )}
      <label className="field"><span>데이터 비밀번호</span><input className="input" type="password" autoComplete="off" minLength={create ? 8 : 1} required autoFocus value={p1} onChange={(e) => setP1(e.target.value)} /></label>
      {create && (
        <label className="field"><span>한 번 더</span><input className="input" type="password" autoComplete="off" required value={p2} onChange={(e) => setP2(e.target.value)} /></label>
      )}
      <label className="row small" style={{ gap: 8 }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        이 기기에서 기억하기 <span className="muted">(공용 컴퓨터에서는 끄세요)</span>
      </label>
      {msg && <div className="notice bad" style={{ margin: 0 }}>{msg}</div>}
      <button className="btn primary" disabled={busy}>{busy ? '확인 중…' : create ? '만들고 시작하기' : '열기'}</button>
      <button type="button" className="btn ghost sm" onClick={() => signOutAndWipe()}>다른 계정으로 로그인</button>
    </form>
  );
}
