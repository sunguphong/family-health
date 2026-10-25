import { STATUS_LABEL, type Status } from '../lib/types';

// 색만으로 구분하지 않도록 모양 아이콘을 함께 쓴다
const ICON: Record<Status, string> = { normal: '●', caution: '▲', abnormal: '■', none: '·' };

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      <span className="ico" aria-hidden>{ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TrendBadge() {
  return (
    <span className="badge trend" title="최근 3회 검진값이 계속 나빠지는 방향으로 움직였습니다">
      <span aria-hidden>↗</span>3회 연속 악화
    </span>
  );
}
