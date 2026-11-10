import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { SUPABASE_URL, cloudEnabled } from '../config';
import { getUserEmail, isAdmin, useSyncStatus } from '../lib/cloud/sync';
import { db, getSetting } from '../lib/db';
import { AI_MODEL } from '../lib/extract/ai';

const REPO_URL = 'https://github.com/sunguphong/family-health';
const SUPABASE_DASHBOARD = 'https://supabase.com/dashboard/project/ttkqsvrzvmvciefxsffr';

/** 관리자 전용: 이 사이트가 어떻게 만들어져 있는지(호스팅·저장소·외부 서비스·데이터 흐름) 한눈에 */
export default function Admin() {
  const sync = useSyncStatus();
  const counts = useLiveQuery(async () => ({
    members: await db.members.count(),
    exams: await db.exams.count(),
    results: await db.results.count(),
    files: await db.files.count(),
    pages: (await db.files.toArray()).reduce((n, f) => n + f.pages.length, 0),
    aiEnabled: await getSetting('aiEnabled', false),
  }), []);

  if (!isAdmin()) return <Navigate to="/" replace />;

  const siteUrl = location.origin + location.pathname;
  const syncText =
    sync.state === 'off' ? '사용 안 함 (이 기기에만 저장)'
      : sync.state === 'syncing' ? (sync.message ?? '동기화 중')
      : sync.state === 'error' ? `오류: ${sync.message}`
      : sync.state === 'offline' ? '오프라인'
      : sync.lastSyncAt ? `정상 · ${new Date(sync.lastSyncAt).toLocaleTimeString('ko-KR')}` : '정상';

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>인프라 구성도</h1>
          <div className="sub">이 사이트가 어디에서 실행되고, 데이터가 어디에 어떤 형태로 저장되는지 정리했습니다</div>
        </div>
        <span className="badge none">관리자 · {getUserEmail() ?? '이 기기'}</span>
      </div>

      {/* 현재 상태 */}
      <div className="admin-stats">
        <Stat label="저장 방식" value={cloudEnabled ? '서버 + 기기 사본' : '이 기기에만'} sub={cloudEnabled ? 'Supabase (서울) · 종단간 암호화' : 'IndexedDB'} />
        <Stat label="동기화" value={syncText} tone={sync.state === 'error' ? 'bad' : undefined} />
        <Stat label="이 기기의 기록" value={counts ? `검진 ${counts.exams}건` : '-'} sub={counts ? `구성원 ${counts.members} · 수치 ${counts.results} · 원본 ${counts.pages}쪽` : ''} />
        <Stat label="앱 버전" value={__APP_VERSION__} sub={`빌드 ${new Date(__BUILD_TIME__).toLocaleString('ko-KR')}`} />
      </div>

      {/* 구성도 */}
      <section className="card">
        <div className="card-title">
          <h2>구성도</h2>
          <span className="small muted">화살표는 데이터가 오가는 방향</span>
        </div>
        <div className="infra">
          <div className="infra-col">
            <div className="infra-col-title">개발 · 배포</div>
            <Node kind="dev" title="GitHub 저장소" tag="소스 코드" lines={['sunguphong/family-health (공개)', 'React + TypeScript + Vite', '건강 데이터는 들어 있지 않음']} />
            <Arrow dir="down" label="npm run deploy (빌드 결과 업로드)" />
            <Node kind="dev" title="GitHub Pages" tag="호스팅" lines={['sunguphong.github.io/family-health', 'gh-pages 브랜치의 정적 파일', 'HTTPS 자동 적용 · 무료']} />
          </div>

          <div className="infra-links">
            <Arrow dir="right" label="앱 파일 내려받기 (HTTPS)" />
          </div>

          <div className="infra-col">
            <div className="infra-col-title">사용자 기기 (브라우저)</div>
            <div className="infra-device">
              <Node kind="app" title="앱 화면" tag="React SPA" lines={['대시보드 · 기록 · 업로드 · 설정', '그래프 Recharts · 내보내기 SheetJS']} />
              <Node kind="app" title="문서 읽기" tag="기기 안에서" lines={['PDF 글자: pdf.js', '스캔·사진: Tesseract.js OCR']} />
              <Node kind="app" title="식별정보 가림" tag="저장 전" lines={['주민번호·전화번호 자동 가림', '이름 등은 직접 가리기', '원본 PDF는 저장하지 않음']} />
              <Node kind="secure" title="암호화" tag="WebCrypto" lines={['AES-256-GCM', '키: 데이터 비밀번호 → PBKDF2', '키는 기기 밖으로 나가지 않음']} />
              <Node kind="store" title="기기 저장소" tag="IndexedDB" lines={['Dexie로 관리하는 기기 사본', '인터넷이 끊겨도 사용 가능', '로그아웃 시 삭제']} />
            </div>
          </div>

          <div className="infra-links">
            <Arrow dir="both" label="암호문만 주고받음" tone="secure" />
            <Arrow dir="right" label="가린 이미지·수치 (매번 동의 후)" tone="ai" />
            <Arrow dir="left" label="OCR 언어 데이터 (처음 1회)" />
          </div>

          <div className="infra-col">
            <div className="infra-col-title">외부 서비스</div>
            <div className="infra-group">
              <div className="infra-group-title">Supabase · 서울 리전</div>
              <Node kind="store" title="Auth" tag="로그인" lines={['이메일 + 비밀번호', '가입 차단 · 관리자만 계정 발급']} />
              <Node kind="store" title="Database" tag="PostgreSQL" lines={['records: 모든 기록(암호문)', 'vault: 비밀번호 확인값', '행 단위 보안(RLS): 본인 행만']} />
              <Node kind="store" title="Storage" tag="pages 버킷" lines={['원본 이미지(암호문)', '사용자별 폴더만 접근']} />
            </div>
            <Node kind="ai" title="Anthropic Claude API" tag="선택 기능" lines={[`${AI_MODEL}`, 'AI 추출 · AI 건강 코멘트', `현재 ${counts?.aiEnabled ? '켜짐' : '꺼짐'} · 본인 API 키 사용`]} />
            <Node kind="dev" title="jsDelivr CDN" tag="공개 파일" lines={['OCR 엔진·한국어 데이터', '내 파일은 보내지 않음']} />
          </div>
        </div>
        <div className="infra-legend">
          <span><i className="lg k-app" />기기 안 처리</span>
          <span><i className="lg k-secure" />암호화</span>
          <span><i className="lg k-store" />저장소</span>
          <span><i className="lg k-ai" />AI (선택)</span>
          <span><i className="lg k-dev" />배포·공개 자원</span>
        </div>
      </section>

      {/* 데이터별 저장 위치 */}
      <section className="card">
        <div className="card-title"><h2>데이터는 어디에 저장되나</h2></div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>데이터</th><th>기기</th><th>서버</th><th>볼 수 있는 사람</th></tr>
            </thead>
            <tbody>
              <Row d="구성원 · 검진 수치 · 항목 기준 · 설정" dev="IndexedDB (평문)" srv="Supabase DB records (AES-256 암호문)" who="로그인 + 데이터 비밀번호를 아는 본인" />
              <Row d="원본 결과지 이미지" dev="IndexedDB (식별정보 가린 JPEG)" srv="Supabase Storage pages (암호문)" who="본인" />
              <Row d="원본 PDF·사진 파일" dev="저장 안 함" srv="저장 안 함" who="-" />
              <Row d="로그인 계정" dev="로그인 상태(토큰)" srv="Supabase Auth" who="관리자가 발급·삭제" />
              <Row d="데이터 비밀번호" dev="저장 안 함 (‘기억하기’ 시 꺼낼 수 없는 키만)" srv="저장 안 함 (확인값만 vault)" who="본인만 앎 · 잊으면 복구 불가" />
              <Row d="Claude API 키" dev="IndexedDB 설정" srv="records (암호문)" who="본인" />
              <Row d="AI에 보낸 내용" dev="-" srv="Anthropic (보낼 때마다 동의)" who="Anthropic 정책에 따름" />
              <Row d="앱 코드" dev="브라우저 캐시" srv="GitHub 저장소 · Pages (공개)" who="누구나 (데이터 없음)" />
            </tbody>
          </table>
        </div>
      </section>

      {/* 기능별 기술 */}
      <section className="card">
        <div className="card-title"><h2>기능별 사용 기술</h2></div>
        <div className="tech-grid">
          <Tech t="화면" v="React 19 · TypeScript · Vite · React Router(해시 주소)" />
          <Tech t="디자인" v="직접 작성한 CSS · Pretendard 글꼴(앱에 포함)" />
          <Tech t="그래프" v="Recharts" />
          <Tech t="PDF 읽기" v="pdf.js (한글 CMap·이미지 디코더 앱에 포함)" />
          <Tech t="OCR" v="Tesseract.js (한국어+영어)" />
          <Tech t="항목 인식" v="별칭 사전 매칭 + 검토 화면에서 학습" />
          <Tech t="기기 저장" v="IndexedDB · Dexie" />
          <Tech t="서버 저장" v="Supabase (Auth · PostgreSQL · Storage, 서울)" />
          <Tech t="암호화" v="Web Crypto API · PBKDF2(31만 회) → AES-256-GCM" />
          <Tech t="동기화" v="변경분 자동 업로드 · 1분마다·창 포커스 시 받기" />
          <Tech t="AI (선택)" v={`Anthropic Claude API · ${AI_MODEL}`} />
          <Tech t="내보내기" v="CSV · 엑셀(SheetJS) · 인쇄용 한 장 요약" />
          <Tech t="호스팅" v="GitHub Pages (gh-pages 브랜치)" />
        </div>
      </section>

      {/* 바로가기 */}
      <section className="card">
        <div className="card-title"><h2>관리 바로가기</h2></div>
        <div className="row">
          <a className="btn" href={siteUrl} target="_blank" rel="noreferrer">사이트 주소</a>
          <a className="btn" href={REPO_URL} target="_blank" rel="noreferrer">GitHub 저장소</a>
          {cloudEnabled && <a className="btn" href={`${SUPABASE_DASHBOARD}/auth/users`} target="_blank" rel="noreferrer">사용자 관리 (Supabase)</a>}
          {cloudEnabled && <a className="btn" href={SUPABASE_DASHBOARD} target="_blank" rel="noreferrer">Supabase 대시보드</a>}
        </div>
        {cloudEnabled && <p className="small muted" style={{ marginTop: 10 }}>서버 주소: {SUPABASE_URL}</p>}
      </section>
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="admin-stat-value" style={tone === 'bad' ? { color: 'var(--bad-ink)' } : undefined}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

function Node({ kind, title, tag, lines }: { kind: 'app' | 'secure' | 'store' | 'ai' | 'dev'; title: string; tag: string; lines: string[] }) {
  return (
    <div className={`infra-node k-${kind}`}>
      <div className="infra-node-head">
        <b>{title}</b>
        <span>{tag}</span>
      </div>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

function Arrow({ dir, label, tone }: { dir: 'right' | 'left' | 'both' | 'down'; label: string; tone?: 'secure' | 'ai' }) {
  const glyph = { right: '→', left: '←', both: '⇄', down: '↓' }[dir];
  return (
    <div className={`infra-arrow ${dir} ${tone ?? ''}`}>
      <span className="glyph" aria-hidden>{glyph}</span>
      <span className="label">{label}</span>
    </div>
  );
}

function Row({ d, dev, srv, who }: { d: string; dev: string; srv: string; who: ReactNode }) {
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{d}</td>
      <td className="small">{dev}</td>
      <td className="small">{srv}</td>
      <td className="small muted">{who}</td>
    </tr>
  );
}

function Tech({ t, v }: { t: string; v: string }) {
  return (
    <div className="tech">
      <div className="small muted">{t}</div>
      <div>{v}</div>
    </div>
  );
}
