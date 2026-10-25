import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

/** 페이지 위를 드래그해 이름·주소 등 남은 개인정보를 직접 검은 칸으로 가린다 */
export function MaskEditor({ canvas, onDone }: { canvas: HTMLCanvasElement; onDone: (changed: boolean) => void }) {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [changed, setChanged] = useState(false);
  const [, force] = useState(0);

  const redraw = () => {
    const v = viewRef.current;
    if (!v) return;
    v.width = canvas.width;
    v.height = canvas.height;
    const ctx = v.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    if (drag) {
      ctx.fillStyle = 'rgba(17,17,17,0.7)';
      ctx.fillRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    }
  };
  useEffect(redraw);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };

  return (
    <Modal title="직접 가리기" onClose={() => onDone(changed)} wide>
      <p className="small muted" style={{ marginBottom: 8 }}>
        이름, 주소처럼 자동으로 가려지지 않은 정보를 마우스(또는 손가락)로 드래그해 덮으세요. 가린 부분은 되돌릴 수 없고, 저장·전송되는 이미지에 그대로 반영됩니다.
      </p>
      <canvas
        ref={viewRef}
        style={{ width: '100%', touchAction: 'none', border: '1px solid var(--line)', borderRadius: 6, cursor: 'crosshair' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = pos(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = pos(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (drag && Math.abs(drag.x1 - drag.x0) > 4 && Math.abs(drag.y1 - drag.y0) > 4) {
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#111';
            ctx.fillRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
            setChanged(true);
          }
          setDrag(null);
          force((n) => n + 1);
        }}
      />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn primary" onClick={() => onDone(changed)}>완료</button>
      </div>
    </Modal>
  );
}
