import { createContext, useContext, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Member } from './types';

interface Ctx {
  ready: boolean;
  members: Member[];
  member: Member | undefined;
  setMemberId: (id: number) => void;
}

const MemberCtx = createContext<Ctx>({ ready: false, members: [], member: undefined, setMemberId: () => {} });

const KEY = 'activeMemberId';
function readStored(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function MemberProvider({ children }: { children: ReactNode }) {
  const loaded = useLiveQuery(() => db.members.toArray(), []);
  const members = loaded ?? [];
  const [id, setId] = useState<number | null>(readStored);

  // 저장된 구성원이 지워졌으면 첫 번째 구성원을 보여 준다
  const member = members.find((m) => m.id === id) ?? members[0];

  const setMemberId = (v: number) => {
    setId(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* 저장 못 해도 동작에는 지장 없음 */
    }
  };

  return <MemberCtx.Provider value={{ ready: loaded !== undefined, members, member, setMemberId }}>{children}</MemberCtx.Provider>;
}

export const useMember = () => useContext(MemberCtx);

export function MemberPicker() {
  const { members, member, setMemberId } = useMember();
  if (members.length < 2) return null;
  return (
    <div className="chips" role="tablist" aria-label="구성원 선택">
      {members.map((m) => (
        <button
          key={m.id}
          className={`chip ${m.id === member?.id ? 'active' : ''}`}
          onClick={() => setMemberId(m.id!)}
          role="tab"
          aria-selected={m.id === member?.id}
        >
          {m.name}
        </button>
      ))}
    </div>
  );
}
