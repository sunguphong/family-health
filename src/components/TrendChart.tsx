import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GRADE_LABELS } from '../lib/items';
import { formatValue, rangeFor, type Point } from '../lib/status';
import { STATUS_LABEL, type ItemDef, type Sex, type Status } from '../lib/types';

const DOT: Record<Status, string> = { normal: 'var(--good)', caution: 'var(--warn)', abnormal: 'var(--bad)', none: 'var(--chart-line)' };
const LINE = 'var(--chart-line)';
const TICK = { fontSize: 11, fill: 'var(--ink-3)' };

interface Props {
  def: ItemDef;
  sex: Sex;
  points: Point[];
  height?: number;
  /** 점을 누르면 그 검진 기록으로 이동 */
  onPointClick?: (p: Point) => void;
}

export function TrendChart({ def, sex, points, height = 150, onPointClick }: Props) {
  const gid = useId().replace(/:/g, '');
  const data = points.map((p) => ({ ...p, label: p.date.slice(2, 7).replace('-', '.') }));
  const normal = rangeFor(def, sex)?.normal;

  let lo: number;
  let hi: number;
  if (def.kind === 'grade') {
    lo = 0;
    hi = Math.max(2, ...points.map((p) => p.value + 1));
  } else {
    const vals = points.map((p) => p.value);
    const marks = [...vals, normal?.min, normal?.max].filter((v): v is number => v != null && v > 0);
    lo = Math.min(...marks);
    hi = Math.max(...marks);
    const pad = (hi - lo || hi * 0.2 || 1) * 0.18;
    lo = Math.max(0, lo - pad);
    hi = hi + pad;
    const step = def.decimals > 0 ? 10 ** -def.decimals : 1;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
  }

  const bandLo = normal?.min != null ? Math.max(normal.min, lo) : lo;
  const bandHi = normal?.max != null ? Math.min(normal.max, hi) : hi;

  return (
    <div style={{ width: '100%', height }} aria-label={`${def.name} 연도별 추이`}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity={0.28} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          {normal && bandHi > bandLo && (
            <ReferenceArea y1={bandLo} y2={bandHi} fill="var(--band)" stroke="rgba(52,211,153,0.18)" strokeDasharray="3 4" ifOverflow="hidden" />
          )}
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={TICK} padding={{ left: 14, right: 14 }} />
          <YAxis
            domain={[lo, hi]}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={TICK}
            allowDecimals={def.kind !== 'grade' && def.decimals > 0}
            ticks={def.kind === 'grade' ? Array.from({ length: hi + 1 }, (_, i) => i) : undefined}
            tickFormatter={(v: number) => (def.kind === 'grade' ? (['음성', '±', '+1', '+2', '+3', '+4'][v] ?? '') : formatValue(def, v))}
          />
          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              const p = active && (payload?.[0]?.payload as (Point & { label: string }) | undefined);
              if (!p) return null;
              return (
                <div className="chart-tip">
                  <div className="muted small">{p.date}</div>
                  <div className="num">
                    <b>{def.kind === 'grade' ? GRADE_LABELS[p.value] : formatValue(def, p.value)}</b>
                    {def.kind !== 'grade' && def.unit ? ` ${def.unit}` : ''}
                    {p.status !== 'none' && <span className="muted"> · {STATUS_LABEL[p.status]}</span>}
                  </div>
                  {onPointClick && <div className="muted small">눌러서 이 검진 기록 보기</div>}
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="value" stroke="none" fill={`url(#fill-${gid})`} isAnimationActive={false} baseValue={lo} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={LINE}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => (
              <circle
                key={props.index}
                cx={props.cx}
                cy={props.cy}
                r={4.5}
                fill={DOT[props.payload?.status ?? 'none']}
                stroke="var(--surface-solid)"
                strokeWidth={2.5}
                style={onPointClick ? { cursor: 'pointer' } : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (props.payload) onPointClick?.(props.payload);
                }}
              />
            )}
            activeDot={(props: { cx?: number; cy?: number; payload?: Point }) => (
              <circle
                cx={props.cx}
                cy={props.cy}
                r={7}
                fill={DOT[props.payload?.status ?? 'none']}
                stroke="var(--surface-solid)"
                strokeWidth={3}
                style={onPointClick ? { cursor: 'pointer' } : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (props.payload) onPointClick?.(props.payload);
                }}
              />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
