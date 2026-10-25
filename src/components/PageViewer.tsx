import { useEffect, useRef, useState } from 'react';
import type { Loc } from '../lib/types';
import { Modal } from './Modal';

interface Props {
  pages: Blob[];
  /** 강조할 위치. key가 바뀔 때마다 그 위치로 스크롤한다 */
  focus?: { loc: Loc; key: number; label?: string } | null;
}

/** 저장된(식별정보를 가린) 페이지 이미지 보기 */
export function PageViewer({ pages, focus }: Props) {
  const [urls, setUrls] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const u = pages.map((p) => URL.createObjectURL(p));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [pages]);

  // 강조 위치가 보이도록 원본 목록을 스크롤 (이미지가 아직 안 그려졌으면 로드 후 다시)
  useEffect(() => {
    if (!focus) return;
    const scroll = () => {
      const box = boxRef.current;
      const page = pageRefs.current[focus.loc.page];
      if (!box || !page) return;
      const img = page.querySelector('img');
      if (!img || !img.complete || !img.naturalHeight) return void img?.addEventListener('load', scroll, { once: true });
      const top = page.offsetTop - box.offsetTop + focus.loc.y * page.clientHeight;
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' });
    };
    scroll();
  }, [focus, urls]);

  if (!pages.length) return <p className="muted small">원본 이미지가 없습니다.</p>;
  return (
    <>
      <div className="pages" ref={boxRef}>
        {urls.map((u, i) => (
          <div key={u} className="page-wrap" ref={(el) => { pageRefs.current[i] = el; }}>
            <img src={u} alt={`원본 ${i + 1}쪽`} onClick={() => setOpen(i)} />
            <span className="page-no">{i + 1}</span>
            {focus && focus.loc.page === i && (
              <div
                key={focus.key}
                className="loc-hl"
                style={{
                  left: `${(focus.loc.x - 0.006) * 100}%`,
                  top: `${(focus.loc.y - 0.004) * 100}%`,
                  width: `${(focus.loc.w + 0.012) * 100}%`,
                  height: `${(focus.loc.h + 0.008) * 100}%`,
                }}
              >
                {focus.label && <span>{focus.label}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {open != null && urls[open] && (
        <Modal title={`원본 ${open + 1} / ${urls.length}쪽`} onClose={() => setOpen(null)} wide>
          <div className="page-wrap">
            <img src={urls[open]} alt={`원본 ${open + 1}쪽 확대`} style={{ width: '100%', display: 'block' }} />
            {focus && focus.loc.page === open && (
              <div
                className="loc-hl"
                style={{
                  left: `${(focus.loc.x - 0.006) * 100}%`,
                  top: `${(focus.loc.y - 0.004) * 100}%`,
                  width: `${(focus.loc.w + 0.012) * 100}%`,
                  height: `${(focus.loc.h + 0.008) * 100}%`,
                }}
              />
            )}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <button className="btn" disabled={open === 0} onClick={() => setOpen(open - 1)}>‹ 이전</button>
            <button className="btn" onClick={() => setOpen(null)}>닫기</button>
            <button className="btn" disabled={open === urls.length - 1} onClick={() => setOpen(open + 1)}>다음 ›</button>
          </div>
        </Modal>
      )}
    </>
  );
}
