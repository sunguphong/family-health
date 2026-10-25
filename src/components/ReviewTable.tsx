import { useState } from 'react';
import { db } from '../lib/db';
import { newKey, type Candidate } from '../lib/extract/parse';
import { GRADE_LABELS } from '../lib/items';
import { checkCandidate } from '../lib/review';
import { judge } from '../lib/status';
import { GROUPS, type GroupKey, type ItemDef, type Sex } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { Modal } from './Modal';

interface Props {
  rows: Candidate[];
  onChange: (rows: Candidate[]) => void;
  items: ItemDef[];
  sex: Sex;
}

const SOURCE_LABEL: Record<Candidate['source'], string> = {
  local: '자동', ai: 'AI', manual: '직접', calc: '계산', saved: '저장됨',
};

export function ReviewTable({ rows, onChange, items, sex }: Props) {
  const defs = new Map(items.map((d) => [d.code, d]));
  const [newFor, setNewFor] = useState<Candidate | null>(null);

  const update = (key: string, patch: Partial<Candidate>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const used = new Set(rows.map((r) => r.itemCode));
  const missing = items.filter((d) => !d.custom && !used.has(d.code));
  const warnCount = rows.filter((r) => r.itemCode && checkCandidate(r, defs.get(r.itemCode), rows).warnings.length).length;

  return (
    <div className="stack">
      {warnCount > 0 && (
        <div className="notice warn" style={{ margin: 0 }}>
          <span aria-hidden>▲</span>
          <span>노란색 줄 {warnCount}개는 확인이 필요합니다. 원본 이미지와 비교해 값을 고쳐 주세요.</span>
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>원문 항목명</th>
              <th>표준 항목</th>
              <th>값</th>
              <th>판정</th>
              <th aria-label="삭제" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const def = defs.get(r.itemCode);
              const chk = checkCandidate(r, def, rows);
              const warn = chk.warnings.length > 0;
              return (
                <tr key={r.key} className={!r.itemCode ? 'skip' : warn ? 'warn' : ''}>
                  <td style={{ minWidth: 110 }}>
                    {r.source === 'manual' ? (
                      <input className="input sm" value={r.rawName} placeholder="항목명" onChange={(e) => update(r.key, { rawName: e.target.value })} />
                    ) : (
                      <>
                        <div>{r.rawName || '-'}</div>
                        <div className="small muted">{SOURCE_LABEL[r.source]}{r.rawValue && r.rawValue !== r.value ? ` · 원문 "${r.rawValue}"` : ''}</div>
                      </>
                    )}
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <select
                      className="input sm"
                      value={r.itemCode}
                      onChange={(e) => {
                        if (e.target.value === '__new') setNewFor(r);
                        else update(r.key, { itemCode: e.target.value });
                      }}
                    >
                      <option value="">— 저장 안 함 —</option>
                      {GROUPS.map((g) => (
                        <optgroup key={g.key} label={g.label}>
                          {items.filter((d) => d.group === g.key).map((d) => (
                            <option key={d.code} value={d.code}>{d.name}</option>
                          ))}
                        </optgroup>
                      ))}
                      <option value="__new">＋ 새 항목으로 추가…</option>
                    </select>
                  </td>
                  <td style={{ minWidth: 150 }}>
                    {def?.kind === 'grade' ? (
                      <select className={`input sm ${warn ? 'warn' : ''}`} value={chk.value ?? ''} onChange={(e) => update(r.key, { value: e.target.value })}>
                        {chk.value == null && <option value="">{r.value || '선택'}</option>}
                        {GRADE_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
                      </select>
                    ) : (
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                        <input
                          className={`input sm num ${warn ? 'warn' : ''}`}
                          style={{ width: 90 }}
                          inputMode="decimal"
                          value={r.value}
                          onChange={(e) => update(r.key, { value: e.target.value })}
                          aria-label={`${def?.name ?? r.rawName} 값`}
                        />
                        <span className="small muted">{def?.unit ?? r.unit}</span>
                      </div>
                    )}
                    {chk.warnings.map((w) => (
                      <div key={w} className="small" style={{ color: 'var(--warn-ink)', marginTop: 2 }}>{w}</div>
                    ))}
                  </td>
                  <td>{def && chk.value != null ? <StatusBadge status={judge(def, chk.value, sex)} /> : null}</td>
                  <td>
                    <button className="btn ghost sm" aria-label="이 줄 삭제" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button
          className="btn sm"
          onClick={() => onChange([...rows, { key: newKey(), rawName: '', rawValue: '', itemCode: missing[0]?.code ?? '', value: '', unit: '', source: 'manual' }])}
        >
          ＋ 항목 직접 추가
        </button>
        {missing.length > 0 && (
          <span className="small muted">빠진 기본 항목: {missing.map((d) => d.name).join(', ')}</span>
        )}
      </div>

      {newFor && (
        <NewItemModal
          rawName={newFor.rawName}
          unit={newFor.unit}
          count={items.length}
          onClose={() => setNewFor(null)}
          onCreated={(code) => {
            update(newFor.key, { itemCode: code });
            setNewFor(null);
          }}
        />
      )}
    </div>
  );
}

export function NewItemModal({
  rawName, unit, count, onClose, onCreated,
}: { rawName: string; unit: string; count: number; onClose: () => void; onCreated: (code: string) => void }) {
  const [name, setName] = useState(rawName);
  const [u, setU] = useState(unit);
  const [group, setGroup] = useState<GroupKey>('etc');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    const code = `custom_${Date.now().toString(36)}`;
    const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
    const normal = { min: num(min), max: num(max) };
    const hasRange = normal.min != null || normal.max != null;
    await db.items.add({
      code, name: name.trim(), group, unit: u.trim(), aliases: rawName ? [rawName] : [], kind: 'number', decimals: 1,
      better: 'none', order: 100 + count, custom: true,
      ranges: hasRange ? { M: { normal }, F: { normal } } : undefined,
    });
    onCreated(code);
  };

  return (
    <Modal title="새 검사 항목 추가" onClose={onClose}>
      <div className="form-grid">
        <label className="field"><span>항목명</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>단위</span><input className="input" value={u} onChange={(e) => setU(e.target.value)} placeholder="예: mg/dL" /></label>
        <label className="field">
          <span>그룹</span>
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <label className="field"><span>참고범위 최소 (선택)</span><input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label className="field"><span>참고범위 최대 (선택)</span><input className="input" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>참고범위는 결과지에 적힌 값을 그대로 옮겨 적으면 됩니다. 나중에 설정에서 바꿀 수 있어요.</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" onClick={save} disabled={!name.trim()}>추가</button>
      </div>
    </Modal>
  );
}
