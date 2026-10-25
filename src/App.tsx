import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { db, getSetting, setSetting } from './lib/db';
import { loadSampleData } from './lib/sample';
import { MemberProvider } from './lib/member';
import { AuthGate } from './components/AuthGate';
import { SyncPill } from './components/SyncPill';
import { cloudEnabled } from './config';
import Dashboard from './pages/Dashboard';
import Records from './pages/Records';
import ExamDetail from './pages/ExamDetail';
import Upload from './pages/Upload';
import Settings from './pages/Settings';
import PrintSummary from './pages/PrintSummary';
import { IconHome, IconList, IconPulse, IconSettings, IconShield, IconUpload } from './components/Icons';

const NAV = [
  { to: '/', label: '대시보드', icon: <IconHome /> },
  { to: '/records', label: '기록', icon: <IconList /> },
  { to: '/upload', label: '업로드', icon: <IconUpload /> },
  { to: '/settings', label: '설정', icon: <IconSettings /> },
];

let seedStarted = false;

export default function App() {
  const loc = useLocation();
  const printing = loc.pathname.startsWith('/print');

  // 처음 실행하면 시연용 샘플 데이터를 한 번 넣어 준다
  useEffect(() => {
    // 서버 저장 모드에서는 샘플을 자동으로 넣지 않는다 (설정에서 직접 불러올 수 있음)
    if (seedStarted || cloudEnabled) return;
    seedStarted = true;
    (async () => {
      if (await getSetting('seeded', false)) return;
      let skip = false;
      try {
        skip = !!localStorage.getItem('noSampleSeed');
      } catch {
        /* 저장소를 못 쓰면 샘플을 넣는다 */
      }
      if (!skip && (await db.members.count()) === 0) await loadSampleData();
      await setSetting('seeded', true);
    })();
  }, []);

  return (
    <AuthGate>
    <MemberProvider>
      <div className="app">
        {!printing && (
          <nav className="sidebar" aria-label="주 메뉴">
            <div className="brand">
              <span className="brand-mark"><IconPulse /></span>
              <span>우리집 건강검진<small>Family Health Record</small></span>
            </div>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                {n.icon}
                {n.label}
              </NavLink>
            ))}
            {cloudEnabled ? <SyncPill /> : <div className="sidebar-foot"><IconShield />모든 기록은 이 기기의 브라우저 안에만 저장됩니다.</div>}
          </nav>
        )}
        <main className="main" style={printing ? { maxWidth: 'none', padding: 0 } : undefined}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/records" element={<Records />} />
            <Route path="/records/:id" element={<ExamDetail />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/print/:memberId" element={<PrintSummary />} />
          </Routes>
        </main>
      </div>
    </MemberProvider>
    </AuthGate>
  );
}
