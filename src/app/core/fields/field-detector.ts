import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FieldType, type Rect } from './field.model';

export interface DetectedField extends Rect {
  page: number;
  type: FieldType;
  label: string;
}

interface Cue {
  pattern: RegExp;
  type: FieldType;
}

/** Words that usually sit next to a place to fill in, in English and Arabic. */
const CUES: Cue[] = [
  { pattern: /\b(signature|signed by|sign here)\b|التوقيع|توقيع/i, type: FieldType.Signature },
  { pattern: /\binitials?\b|الأحرف الأولى/i, type: FieldType.Initials },
  { pattern: /\bstamp\b|\bseal\b|الختم|ختم/i, type: FieldType.Stamp },
  { pattern: /\bhijri\b|هجري/i, type: FieldType.HijriDate },
  { pattern: /\bdate\b|التاريخ/i, type: FieldType.SignDate },
  { pattern: /\b(full )?name\b|الاسم/i, type: FieldType.FullName },
  { pattern: /\bjob title\b|\bposition\b|\btitle\b|المسمى الوظيفي|المنصب/i, type: FieldType.JobTitle },
  { pattern: /\bcompany\b|\bcorporation\b|الشركة|المؤسسة/i, type: FieldType.Company },
  { pattern: /\be-?mail\b|البريد/i, type: FieldType.Email },
  { pattern: /\b(mobile|phone)\b|الجوال|الهاتف/i, type: FieldType.Mobile },
];

/** A run of underscores or dots is a blank line to fill. */
const BLANK = /_{4,}|\.{6,}|…{3,}/;

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Reads the text of each page and suggests fields where a cue word (e.g.
 * "Signature:", "التاريخ") is followed by a blank, or sits at the end of a line.
 * Positions are page fractions, ready for the field store.
 */
export async function detectFields(
  pdf: PDFDocumentProxy, pages: readonly number[], onProgress?: (done: number) => void, stop?: AbortSignal,
): Promise<DetectedField[]> {
  const found: DetectedField[] = [];
  let done = 0;
  for (const pageNumber of pages) {
    if (stop?.aborted) {
      break;
    }
    const page = await pdf.getPage(pageNumber);
    const { width: pw, height: ph } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = (content.items as TextItem[]).filter(i => i.str?.trim());
    for (const item of items) {
      const cue = CUES.find(c => c.pattern.test(item.str));
      if (!cue) {
        continue;
      }
      const [, , , , x, y] = item.transform;
      const height = Math.max(item.height, 10);
            // A blank on the same line (to the right in LTR, to the left in RTL) is the best spot.
      const rtl = /[؀-ۿ]/.test(item.str);
      // The nearest blank after the label (to the right in LTR, to the left in RTL) on the same line.
      const blank = items
        .filter(o => o !== item && Math.abs(o.transform[5] - y) < height * 0.6 && BLANK.test(o.str))
        .filter(o => (rtl ? o.transform[4] < x : o.transform[4] >= x + item.width - 1))
        .sort((p, q) => Math.abs(p.transform[4] - x) - Math.abs(q.transform[4] - x))[0];
      const fieldHeight = cue.type === FieldType.Signature ? 0.036 : cue.type === FieldType.Stamp ? 0.1 : 0.028;
      const defaultWidth = cue.type === FieldType.Initials ? 0.12 : cue.type === FieldType.Stamp ? 0.16 : 0.24;
      const fieldWidth = blank ? Math.min(0.4, Math.max(0.12, blank.width / pw)) : defaultWidth;
      let fx: number;
      if (blank) {
        fx = blank.transform[4] / pw;
      } else if (rtl) {
        fx = Math.max(0.02, x / pw - fieldWidth - 0.01);
      } else {
        fx = Math.min(0.98 - fieldWidth, (x + item.width) / pw + 0.01);
      }
      const rect = {
        x: Math.max(0, Math.min(1 - fieldWidth, fx)),
        // Centred just above the baseline, where the blank line is.
        y: Math.max(0, Math.min(1 - fieldHeight, 1 - (y + height * 0.35) / ph - fieldHeight / 2)),
        width: fieldWidth,
        height: fieldHeight,
      };
      // Only cues that look like a label (short, ends with ":" or has a blank) — not every word in a paragraph.
      const labelLike = blank || /[:：]\s*$/.test(item.str.trim()) || item.str.trim().length <= 24;
      if (labelLike) {
        found.push({ page: pageNumber, type: cue.type, label: item.str.replace(/[:：_.…]+/g, '').trim().slice(0, 40), ...rect });
      }
    }
    page.cleanup();
    onProgress?.(++done);
  }
  return found;
}
