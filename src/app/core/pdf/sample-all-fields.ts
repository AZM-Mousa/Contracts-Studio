import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { DEFAULT_SIGNERS, FieldType, newFieldId, type Field } from '../fields/field.model';
import { Validation } from '../enums/validation.enum';

const A4 = { width: 595.28, height: 841.89 };
const LABEL_X = 56;
const FIELD_X = 200 / A4.width;
const FIELD_W = 0.36;
const GAP = 13;

interface Row {
  type: FieldType;
  label: string;
  /** Field height in PDF points. */
  height: number;
  extra?: Partial<Field>;
}

/** Page 1: an employment form with one row per kind of input. */
const FORM: Row[] = [
  { type: FieldType.FullName, label: 'Full name', height: 24 },
  { type: FieldType.JobTitle, label: 'Job title', height: 24 },
  { type: FieldType.Company, label: 'Company', height: 24 },
  { type: FieldType.Email, label: 'Email', height: 24, extra: { validation: Validation.Email } },
  { type: FieldType.Mobile, label: 'Mobile', height: 24, extra: { validation: Validation.MobileSa } },
  { type: FieldType.Text, label: 'National ID', height: 24, extra: { validation: Validation.NationalId, hint: '10 digits' } },
  { type: FieldType.SignDate, label: 'Start date', height: 24 },
  { type: FieldType.HijriDate, label: 'Start date (Hijri)', height: 24 },
  { type: FieldType.Dropdown, label: 'Department', height: 24, extra: { options: ['Finance', 'Human resources', 'IT', 'Legal'] } },
  { type: FieldType.RadioGroup, label: 'Contract type', height: 54, extra: { options: ['Full time', 'Part time', 'Fixed term'] } },
  { type: FieldType.MultiSelect, label: 'Benefits', height: 72, extra: { options: ['Medical insurance', 'Housing allowance', 'Transport allowance', 'Annual ticket'] } },
];

/**
 * A short (2-page) contract with every field type, spread over the three signers, for
 * trying each field in Prepare and Sign without scrolling through a long document.
 */
export async function buildAllFieldsSample(): Promise<{ bytes: Uint8Array; fields: Field[] }> {
  const [sara, omar, lina] = DEFAULT_SIGNERS;
  const pdf = await PDFDocument.create();
  pdf.setTitle('Employment Offer - all field types');
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const fields: Field[] = [];
  const field = (type: FieldType, page: number, x: number, topPt: number, width: number, heightPt: number, signerId: string, extra: Partial<Field> = {}) =>
    fields.push({
      id: newFieldId(), type, page, x, y: topPt / A4.height, width, height: heightPt / A4.height,
      label: '', required: true, readOnly: false, signerId, fontSize: 10, value: null, ...extra,
    });

  // Page 1: the form.
  const p1 = pdf.addPage([A4.width, A4.height]);
  header(p1, bold, font, 1, 'Employment Offer', 'Please complete every field. Fields marked * are required.');
  let top = 150;
  for (const row of FORM) {
    label(p1, font, row.label, top + Math.min(row.height, 24) / 2);
    field(row.type, 1, FIELD_X, top, FIELD_W, row.height, sara.id, { label: row.label, ...row.extra });
    top += row.height + GAP;
  }
  // Checkbox with its sentence beside it.
  label(p1, font, 'Agreement', top + 9);
  field(FieldType.Checkbox, 1, FIELD_X, top, 0.035, 18, sara.id, { label: 'I accept the terms of this offer' });
  top += 18 + GAP + 10;
  // Right column: photo, QR code and barcode.
  const RIGHT_X = 0.74;
  label(p1, font, 'Photo', 160, RIGHT_X * A4.width);
  field(FieldType.Image, 1, RIGHT_X, 172, 0.2, 110, sara.id, { label: 'Photo', required: false });
  label(p1, font, 'QR code', 300, RIGHT_X * A4.width);
  field(FieldType.QrCode, 1, RIGHT_X, 312, 0.14, 84, omar.id, { label: 'QR code', required: false, readOnly: true, value: 'https://github.com/oriebalzyuot96/contract-studio' });
  label(p1, font, 'Reference', 414, RIGHT_X * A4.width);
  field(FieldType.Barcode, 1, RIGHT_X, 426, 0.2, 40, omar.id, { label: 'Reference', required: false, readOnly: true, value: 'MSA-2026-0418' });
  paragraph(p1, font, top + 10, [
    'This offer is subject to the company policies and the labour law of the Kingdom of Saudi Arabia.',
    'The employee confirms that the information above is complete and correct.',
  ]);
  footer(p1, font);

  // Page 2: signatures, one block per signer.
  const p2 = pdf.addPage([A4.width, A4.height]);
  header(p2, bold, font, 2, 'Signatures', 'Each party signs in their own block. Tap any field in Sign mode.');
  const blocks: { title: string; signer: string; rows: Row[] }[] = [
    { title: 'Employee - Sara Al-Harbi', signer: sara.id, rows: [
      { type: FieldType.Signature, label: 'Signature', height: 50 },
      { type: FieldType.Initials, label: 'Initials', height: 34 },
      { type: FieldType.SignDate, label: 'Date', height: 24 },
    ] },
    { title: 'Employer - Omar Haddad', signer: omar.id, rows: [
      { type: FieldType.Signature, label: 'Signature', height: 50 },
      { type: FieldType.Stamp, label: 'Company stamp', height: 84, extra: { required: false } },
      { type: FieldType.HijriDate, label: 'Date (Hijri)', height: 24 },
    ] },
    { title: 'Witness - Lina Nasser', signer: lina.id, rows: [
      { type: FieldType.FullName, label: 'Name', height: 24 },
      { type: FieldType.Signature, label: 'Signature', height: 50 },
      { type: FieldType.Checkbox, label: 'Witnessed', height: 18, extra: { label: 'I witnessed both signatures' } },
    ] },
  ];
  top = 140;
  for (const block of blocks) {
    p2.drawText(block.title, { x: LABEL_X, y: A4.height - top, size: 13, font: bold, color: rgb(0.12, 0.13, 0.16) });
    top += 22;
    for (const row of block.rows) {
      label(p2, font, row.label, top + Math.min(row.height, 24) / 2);
      const width = row.type === FieldType.Checkbox ? 0.035 : row.type === FieldType.Initials ? 0.14 : row.type === FieldType.Stamp ? 0.18 : FIELD_W;
      field(row.type, 2, FIELD_X, top, width, row.height, block.signer, { label: row.type === FieldType.Checkbox ? '' : row.label, ...row.extra });
      top += row.height + GAP;
    }
    top += 16;
  }
  // Initials on page 1 too, for every signer that signs page 2.
  field(FieldType.Initials, 1, 0.79, 790, 0.14, 30, sara.id, { label: 'Initials' });
  footer(p2, font);

  return { bytes: await pdf.save(), fields };
}

const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);

function header(page: PDFPage, bold: PDFFont, font: PDFFont, n: number, title: string, intro: string): void {
  page.drawText('EMPLOYMENT OFFER', { x: LABEL_X, y: A4.height - 52, size: 9, font: bold, color: MUTED });
  page.drawText(`Page ${n} of 2`, { x: 490, y: A4.height - 52, size: 9, font, color: MUTED });
  page.drawLine({ start: { x: LABEL_X, y: A4.height - 62 }, end: { x: 539, y: A4.height - 62 }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) });
  page.drawText(title, { x: LABEL_X, y: A4.height - 98, size: 20, font: bold, color: INK });
  page.drawText(intro, { x: LABEL_X, y: A4.height - 118, size: 10, font, color: MUTED });
}

/** A label whose middle sits at `midPt` points from the top. */
function label(page: PDFPage, font: PDFFont, text: string, midPt: number, x = LABEL_X): void {
  page.drawText(text, { x, y: A4.height - midPt - 3.5, size: 10.5, font, color: INK });
}

function paragraph(page: PDFPage, font: PDFFont, topPt: number, lines: string[]): void {
  lines.forEach((line, i) => page.drawText(line, { x: LABEL_X, y: A4.height - topPt - i * 15, size: 10, font, color: MUTED }));
}

function footer(page: PDFPage, font: PDFFont): void {
  page.drawText('Initials', { x: 470, y: 64, size: 8, font, color: MUTED });
}
