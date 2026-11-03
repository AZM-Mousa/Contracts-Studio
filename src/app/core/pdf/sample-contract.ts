import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { DEFAULT_SIGNERS, FIELD_META, FieldType, newFieldId, type Field } from '../fields/field.model';

const CLAUSES = [
  'The Supplier shall deliver the Services described in Schedule A with reasonable skill and care.',
  'The Customer shall pay each invoice within thirty (30) days of the date of receipt.',
  'Either party may terminate this Agreement by giving ninety (90) days written notice.',
  'All confidential information shall be kept secret and used only for the purpose of this Agreement.',
  'Liability of either party shall not exceed the total fees paid in the twelve months before the claim.',
  'This Agreement is governed by the laws of the Kingdom and the courts of Riyadh have jurisdiction.',
  'Any change to this Agreement must be in writing and signed by authorised representatives.',
  'Personal data shall be processed only in accordance with the applicable data protection law.',
];

const A4 = { width: 595.28, height: 841.89 };

/** Builds a long, realistic contract PDF in the browser. */
export async function buildSampleContract(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Master Services Agreement (${pages} pages)`);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const ink = rgb(0.12, 0.13, 0.16);
  const muted = rgb(0.42, 0.45, 0.5);

  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([A4.width, A4.height]);
    const n = i + 1;
    page.drawText('MASTER SERVICES AGREEMENT', { x: 56, y: 790, size: 9, font: bold, color: muted });
    page.drawText(`Page ${n} of ${pages}`, { x: 470, y: 790, size: 9, font, color: muted });
    page.drawLine({ start: { x: 56, y: 780 }, end: { x: 539, y: 780 }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) });
    page.drawText(n === 1 ? 'Master Services Agreement' : `Clause ${n}. ${n % 5 === 0 ? 'Schedule and Fees' : 'Terms and Conditions'}`, {
      x: 56, y: 745, size: n === 1 ? 22 : 15, font: bold, color: ink,
    });
    let y = n === 1 ? 700 : 715;
    const paragraphs = n === 1 ? 6 : 9;
    for (let p = 0; p < paragraphs; p++) {
      const text = `${n}.${p + 1}  ${CLAUSES[(n + p) % CLAUSES.length]}`;
      for (const line of wrap(text, 92)) {
        page.drawText(line, { x: 56, y, size: 11, font, color: ink });
        y -= 15;
      }
      y -= 9;
    }
    if (n % 5 === 0) {
      drawFeesTable(page, y - 10, font, bold, ink);
    }
    if (n === 2 && pages > 2) {
      drawWitnessBlock(page, font, bold, ink, muted);
    }
    page.drawText('Initials', { x: 470, y: 64, size: 8, font, color: muted });
  }
  return pdf.save({ useObjectStreams: true });
}

/** Labelled blank lines with no fields on them, so "Find fields automatically" has something to find. */
function drawWitnessBlock(page: import('pdf-lib').PDFPage, font: import('pdf-lib').PDFFont, bold: import('pdf-lib').PDFFont, ink: ReturnType<typeof rgb>, muted: ReturnType<typeof rgb>): void {
  page.drawText('Witness', { x: 56, y: 236, size: 12, font: bold, color: ink });
  const line = '______________________';
  [['Witness name:', 210], ['Witness signature:', 175], ['Date:', 140]].forEach(([label, y]) => {
    page.drawText(label as string, { x: 56, y: y as number, size: 10, font, color: muted });
    page.drawText(line, { x: 160, y: y as number, size: 10, font, color: muted });
  });
  page.drawText('Email:', { x: 330, y: 210, size: 10, font, color: muted });
  page.drawText(line, { x: 370, y: 210, size: 10, font, color: muted });
}

function drawFeesTable(page: import('pdf-lib').PDFPage, top: number, font: import('pdf-lib').PDFFont, bold: import('pdf-lib').PDFFont, ink: ReturnType<typeof rgb>): void {
  const rows = [['Item', 'Description', 'Amount (SAR)'], ['1', 'Implementation services', '120,000'], ['2', 'Annual support', '36,000'], ['3', 'Training (5 days)', '15,000']];
  rows.forEach((row, r) => {
    const y = top - r * 20;
    page.drawRectangle({ x: 56, y: y - 6, width: 483, height: 20, borderColor: rgb(0.75, 0.77, 0.8), borderWidth: 0.6, color: r === 0 ? rgb(0.95, 0.96, 0.98) : undefined });
    row.forEach((cell, c) => page.drawText(cell, { x: [64, 110, 440][c], y, size: 10, font: r === 0 ? bold : font, color: ink }));
  });
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > width) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  return line ? [...lines, line] : lines;
}

const DENSE_TYPES: FieldType[] = [
  FieldType.FullName, FieldType.Email, FieldType.Mobile, FieldType.JobTitle, FieldType.Company, FieldType.Text,
  FieldType.SignDate, FieldType.HijriDate, FieldType.Checkbox, FieldType.Initials,
];

/** Stress test: 40 fields on every page in a 4 × 10 grid, cycling through signers and kinds. */
export function denseFields(pages: number, perPage = 40): Field[] {
  const signers = DEFAULT_SIGNERS;
  const cols = 4;
  const rows = Math.ceil(perPage / cols);
  const cellW = 0.84 / cols;
  const cellH = 0.82 / rows;
  const fields: Field[] = new Array(pages * perPage);
  let n = 0;
  for (let page = 1; page <= pages; page++) {
    for (let i = 0; i < perPage; i++) {
      const type = DENSE_TYPES[(i + page) % DENSE_TYPES.length];
      const col = i % cols;
      const row = Math.floor(i / cols);
      fields[n++] = {
        id: `d${page}-${i}`, type, page,
        x: 0.08 + col * cellW, y: 0.09 + row * cellH,
        width: type === FieldType.Checkbox ? 0.035 : cellW - 0.012, height: type === FieldType.Checkbox ? 0.025 : Math.min(0.035, cellH - 0.01),
        label: '', required: i % 3 !== 0, readOnly: false, signerId: signers[i % signers.length].id, fontSize: 9, value: null,
      };
    }
  }
  return fields;
}

/** Fields like a real contract: initials on every page, signing block at the end. */
export function sampleFields(pages: number): Field[] {
  const [first, second, third] = DEFAULT_SIGNERS;
  const field = (type: FieldType, page: number, x: number, y: number, signerId: string, extra: Partial<Field> = {}): Field => ({
    id: newFieldId(), type, page, x, y,
    width: FIELD_META[type].width, height: FIELD_META[type].height,
    label: '', required: true, readOnly: false, signerId, fontSize: 10, value: null, ...extra,
  });
  const fields: Field[] = [
    field(FieldType.FullName, 1, 0.09, 0.5, first.id),
    field(FieldType.JobTitle, 1, 0.42, 0.5, first.id),
    field(FieldType.Company, 1, 0.09, 0.56, second.id),
    field(FieldType.Email, 1, 0.42, 0.56, second.id, { required: false }),
  ];
  for (let p = 1; p <= pages; p++) {
    fields.push(field(FieldType.Initials, p, 0.79, 0.9, first.id));
    if (p % 5 === 0) {
      fields.push(field(FieldType.Checkbox, p, 0.09, 0.82, second.id, { label: 'I accept the fees schedule' }));
    }
  }
  fields.push(
    field(FieldType.Signature, pages, 0.09, 0.72, first.id),
    field(FieldType.SignDate, pages, 0.09, 0.8, first.id),
    field(FieldType.Signature, pages, 0.55, 0.72, second.id),
    field(FieldType.Stamp, pages, 0.55, 0.58, third.id, { required: false }),
    field(FieldType.HijriDate, pages, 0.55, 0.8, second.id),
  );
  return fields;
}
