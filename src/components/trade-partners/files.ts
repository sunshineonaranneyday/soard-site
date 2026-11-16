/**
 * Getting a vendor's file ready to send (the trade-partner page):
 *   - an iPhone photo (HEIC) becomes a JPEG: Safari draws it itself, any other
 *     browser fetches libheif (src/utils/heic-to.js, 3 MB) the first time
 *   - every photo goes up as a JPEG at most 2400 px across, on white
 *     (both by src/utils/photo-prep.ts, which the Advisory Board application shares)
 *   - a PDF goes as it is, with its first pages drawn as pictures by pdf.js
 *     (public/trade-partners/pdf/), because a W-9's signature and what's typed
 *     into a form's boxes aren't in a PDF's text
 * Files are read into memory first, so one that moves or changes after it's
 * picked fails here, in words, not halfway through sending.
 */

import { isHeic, toJpeg } from '../../utils/photo-prep';

export { isHeic, toJpeg };
export const MAX_BYTES = 15 * 1024 * 1024;
const PDF_BASE = '/trade-partners/pdf/';
const PAGE_SIDE = 2000;

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** What goes up: a PDF as it is, a photo as a JPEG → File, or null for an iPhone photo nothing could open */
export async function prepare(f: File): Promise<File | null> {
  if (await isHeic(f)) {
    const own = await toJpeg(f, f.name, true);
    if (own) return own;
    try {
      const { heicTo } = await import('../../utils/heic-to.js');
      return toJpeg(await heicTo({ blob: f, type: 'image/jpeg', quality: 0.92 }), f.name, true);
    } catch {
      return null;
    }
  }
  if (!f.type.startsWith('image/')) return new File([await f.arrayBuffer()], f.name, { type: f.type });
  return (await toJpeg(f, f.name)) || new File([await f.arrayBuffer()], f.name, { type: f.type });
}

let pdfjs: Promise<any> | null = null;
const loadPdf = () => (pdfjs ||= import(/* @vite-ignore */ `${PDF_BASE}pdf.js`).then((m) => {
  m.GlobalWorkerOptions.workerSrc = `${PDF_BASE}pdf.worker.js`;
  return m;
}).catch((e) => { pdfjs = null; throw e; }));

/**
 * A PDF's first pages as JPEG pictures (print mode: form boxes drawn with what's typed in them).
 * side: the long side in pixels. [] when this browser can't draw it, and the server reads the PDF's text instead.
 */
export async function pagePictures(f: File, max: number, side = PAGE_SIDE): Promise<Blob[]> {
  try {
    const lib = await loadPdf();
    const task = lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), standardFontDataUrl: `${PDF_BASE}standard_fonts/`, wasmUrl: `${PDF_BASE}wasm/`, useWasm: false, enableXfa: false });
    const out: Blob[] = [];
    try {
      const doc = await task.promise;
      for (let n = 1; n <= Math.min(max, doc.numPages); n++) {
        const page = await doc.getPage(n);
        const one = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: side / Math.max(one.width, one.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport, background: 'white', annotationMode: lib.AnnotationMode.ENABLE_STORAGE }).promise;
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
        if (blob) out.push(blob);
      }
    } finally {
      task.destroy();
    }
    return out;
  } catch {
    return [];
  }
}

/** A small picture of a file for its card: a photo itself, a PDF's first page; null when there's none */
export async function thumbnail(f: File): Promise<string | null> {
  if (f.type.startsWith('image/')) return URL.createObjectURL(f);
  if (!isPdf(f)) return null;
  const [p] = await pagePictures(f, 1, 360);
  return p ? URL.createObjectURL(p) : null;
}

export const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
