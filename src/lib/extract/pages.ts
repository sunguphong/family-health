import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, PSM, type Worker } from 'tesseract.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 20;
const MAX_IMAGE_SIDE = 2400;

/** 캔버스 픽셀 좌표 기준의 글자 상자 */
export interface TextBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLine {
  text: string;
  boxes: TextBox[];
}

export interface RawPage {
  canvas: HTMLCanvasElement;
  lines: TextLine[];
  source: 'pdf-text' | 'ocr';
}

export type Progress = (msg: string, ratio?: number) => void;

/** 같은 줄에 놓인 상자들을 묶어 줄 단위 텍스트로 만든다 */
function groupLines(boxes: TextBox[]): TextLine[] {
  const sorted = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines: TextBox[][] = [];
  for (const b of sorted) {
    const cy = b.y + b.h / 2;
    const line = lines.find((l) => {
      const ref = l[0];
      return Math.abs(ref.y + ref.h / 2 - cy) < Math.max(ref.h, b.h) * 0.5;
    });
    if (line) line.push(b);
    else lines.push([b]);
  }
  return lines.map((l) => {
    l.sort((a, b) => a.x - b.x);
    // 상자 사이에 공백을 넣어 셀 경계가 숫자끼리 붙지 않게 한다
    return { text: l.map((b) => b.text).join(' '), boxes: l };
  });
}

/** 비밀번호가 걸린 PDF를 열 때 호출. null을 돌려주면 취소. 비밀번호는 어디에도 저장하지 않는다. */
export type AskPassword = (fileName: string, wrong: boolean) => Promise<string | null>;

// 한글 CID 글꼴, 표준 글꼴, 스캔 PDF용 이미지 디코더(JBIG2·JPEG2000)를 앱에 함께 넣어 오프라인에서도 읽게 한다
const PDF_ASSETS = new URL('pdfjs/', document.baseURI).href;

async function pdfPages(file: File, progress: Progress, askPassword: AskPassword): Promise<{ canvas: HTMLCanvasElement; boxes: TextBox[] }[]> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${PDF_ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_ASSETS}standard_fonts/`,
    wasmUrl: `${PDF_ASSETS}wasm/`,
    iccUrl: `${PDF_ASSETS}iccs/`,
  });
  let cancelled = false;
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    askPassword(file.name, reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((pw) => {
      if (pw == null) {
        cancelled = true;
        task.destroy();
      } else update(pw);
    });
  };
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (cancelled) throw new Error(`${file.name}: 비밀번호 입력을 취소했습니다.`);
    const name = (e as Error).name;
    if (name === 'InvalidPDFException') throw new Error(`${file.name}: PDF 파일이 손상되었거나 PDF가 아닙니다.`);
    throw new Error(`${file.name}: ${(e as Error).message}`);
  }
  const out: { canvas: HTMLCanvasElement; boxes: TextBox[] }[] = [];
  const n = Math.min(doc.numPages, MAX_PAGES);
  for (let i = 1; i <= n; i++) {
    progress(`${file.name}: ${i}/${n}쪽 읽는 중`, (i - 1) / n);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, MAX_IMAGE_SIDE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;

    const content = await page.getTextContent();
    const boxes: TextBox[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const h = Math.hypot(tx[2], tx[3]);
      boxes.push({ text: item.str, x: tx[4], y: tx[5] - h, w: item.width * scale, h: h * 1.15 });
    }
    out.push({ canvas, boxes });
  }
  await task.destroy();
  return out;
}

async function imageCanvas(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}

let ocrWorker: Promise<Worker> | null = null;
function getOcr(progress: Progress) {
  if (!ocrWorker) {
    progress('글자 인식(OCR) 엔진 준비 중… 처음 한 번은 언어 데이터를 내려받아 시간이 걸립니다');
    ocrWorker = createWorker(['kor', 'eng']);
  }
  return ocrWorker;
}

/** OCR용 사본: 작은 이미지는 키우고 흑백으로 바꿔 인식률을 높인다 */
function ocrInput(canvas: HTMLCanvasElement): { img: HTMLCanvasElement; scale: number } {
  const side = Math.max(canvas.width, canvas.height);
  const scale = side < 2400 ? Math.min(3, 2400 / side) : 1;
  const img = document.createElement('canvas');
  img.width = Math.round(canvas.width * scale);
  img.height = Math.round(canvas.height * scale);
  const ctx = img.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(canvas, 0, 0, img.width, img.height);
  return { img, scale };
}

async function ocrCanvas(canvas: HTMLCanvasElement, progress: Progress, label: string): Promise<TextLine[]> {
  const worker = await getOcr(progress);
  progress(`${label}: 글자 인식 중`);
  const { img, scale } = ocrInput(canvas);
  // 결과지는 표 형태라 '흩어진 글자' 모드로 단어를 받고, 줄은 좌표로 다시 묶는다
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(img, {}, { blocks: true, text: true });
  const boxes: TextBox[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          if (!w.text.trim() || w.confidence < 20) continue;
          boxes.push({
            text: w.text,
            x: w.bbox.x0 / scale,
            y: w.bbox.y0 / scale,
            w: (w.bbox.x1 - w.bbox.x0) / scale,
            h: (w.bbox.y1 - w.bbox.y0) / scale,
          });
        }
      }
    }
  }
  return groupLines(boxes);
}

/**
 * 파일을 페이지 이미지 + 줄 단위 텍스트로 바꾼다. 모든 처리는 브라우저 안에서만 이뤄진다.
 * 텍스트가 들어 있는 PDF는 텍스트를 그대로 쓰고, 스캔 PDF나 이미지는 OCR을 돌린다.
 */
export async function readFilePages(file: File, progress: Progress, askPassword: AskPassword): Promise<RawPage[]> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    const canvas = await imageCanvas(file);
    return [{ canvas, lines: await ocrCanvas(canvas, progress, file.name), source: 'ocr' }];
  }
  const pages = await pdfPages(file, progress, askPassword);
  const out: RawPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const { canvas, boxes } = pages[i];
    const textLen = boxes.reduce((s, b) => s + b.text.trim().length, 0);
    if (textLen >= 30) {
      out.push({ canvas, lines: groupLines(boxes), source: 'pdf-text' });
    } else {
      out.push({ canvas, lines: await ocrCanvas(canvas, progress, `${file.name} ${i + 1}쪽`), source: 'ocr' });
    }
  }
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), 'image/jpeg', quality),
  );
}
