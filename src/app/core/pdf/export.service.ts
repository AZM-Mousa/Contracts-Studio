import { inject, Service } from '@angular/core';
import { FieldStore } from '../fields/field-store.service';
import { displayValue, FieldType, isFilled, type Field } from '../fields/field.model';
import { PdfEngine } from './pdf-engine.service';
import { scheduleAfter } from '../../core/utils/schedule.util';

const TEXT_SCALE = 4;

@Service()
export class ExportService {
  readonly #engine = inject(PdfEngine);
  readonly #store = inject(FieldStore);

  json(): void {
    const data = {
      document: this.#engine.fileName(),
      pages: this.#engine.pagesCount(),
      signers: this.#store.signers(),
      fields: this.#store.fields(),
    };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${base(this.#engine.fileName())}.fields.json`);
  }

  /** Writes filled values into the PDF. Text goes in as hi-res images so any script (Arabic too) is kept. */
  async pdf(): Promise<void> {
    const bytes = this.#engine.bytes;
    if (!bytes) {
      return;
    }
    const { PDFDocument, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();
    for (const field of this.#store.fields().filter(isFilled)) {
      const page = pages[field.page - 1];
      if (!page) {
        continue;
      }
      const { width: pw, height: ph } = page.getSize();
      const box = { x: field.x * pw, y: (1 - field.y - field.height) * ph, width: field.width * pw, height: field.height * ph };
      if (field.type === FieldType.Checkbox) {
        page.drawLine({ start: { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 }, end: { x: box.x + box.width * 0.42, y: box.y + box.height * 0.22 }, thickness: 1.6, color: rgb(0.1, 0.1, 0.15) });
        page.drawLine({ start: { x: box.x + box.width * 0.42, y: box.y + box.height * 0.22 }, end: { x: box.x + box.width * 0.82, y: box.y + box.height * 0.8 }, thickness: 1.6, color: rgb(0.1, 0.1, 0.15) });
        continue;
      }
      const png = typeof field.value === 'string' && field.value.startsWith('data:image/') ? field.value : textImage(field, box.width, box.height);
      const image = await doc.embedPng(await (await fetch(png)).arrayBuffer());
      const fit = image.scaleToFit(box.width, box.height);
      page.drawImage(image, { x: box.x + (box.width - fit.width) / 2, y: box.y + (box.height - fit.height) / 2, width: fit.width, height: fit.height });
    }
    const out = await doc.save();
    download(new Blob([out as BlobPart], { type: 'application/pdf' }), `${base(this.#engine.fileName())}.signed.pdf`);
  }
}

function textImage(field: Field, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * TEXT_SCALE);
  canvas.height = Math.ceil(height * TEXT_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111827';
  ctx.font = `500 ${field.fontSize * TEXT_SCALE}px system-ui, 'Segoe UI', Tahoma, sans-serif`;
  ctx.textBaseline = 'middle';
  const rtl = /[֐-ࣿ]/.test(displayValue(field, document.documentElement.lang));
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(displayValue(field, document.documentElement.lang), rtl ? canvas.width - 4 * TEXT_SCALE : 4 * TEXT_SCALE, canvas.height / 2, canvas.width - 8 * TEXT_SCALE);
  return canvas.toDataURL('image/png');
}

function base(name: string): string {
  return (name || 'contract').replace(/\.pdf$/i, '');
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  scheduleAfter(1000, () => URL.revokeObjectURL(url));
}
