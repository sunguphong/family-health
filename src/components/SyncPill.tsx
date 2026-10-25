import { syncNow, useSyncStatus } from '../lib/cloud/sync';

/** 사이드바 아래 동기화 상태 표시. 누르면 바로 동기화 */
export function SyncPill() {
  const s = useSyncStatus();
  const text =
    s.state === 'syncing'
      ? s.message ?? '동기화 중…'
      : s.state === 'error'
        ? `동기화 오류 · 눌러서 다시 시도`
        : s.state === 'offline'
          ? '오프라인 · 연결되면 자동 동기화'
          : s.lastSyncAt
            ? `동기화됨 · ${new Date(s.lastSyncAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
            : '서버 연결됨';
  return (
    <button className={`sync-pill ${s.state}`} title={s.state === 'error' ? s.message : '지금 동기화'} onClick={() => syncNow().catch(() => {})}>
      <span className="dot" />
      <span>{text}</span>
    </button>
  );
}
