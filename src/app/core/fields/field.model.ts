import { Validation } from '../enums/validation.enum';
import { TextDir } from '../enums/text-dir.enum';
import { TextAlign } from '../enums/text-align.enum';
import { StampShape } from '../enums/stamp-shape.enum';
import { DateFormat } from '../enums/date-format.enum';
import { EMAIL_PATTERN, NATIONAL_ID_PATTERN, NUMBER_PATTERN, SAUDI_IBAN_PATTERN, SAUDI_MOBILE_PATTERN } from '../constants/validation.constants';

export enum FieldType {
  Text = 'Text',
  Stamp = 'Stamp',
  Email = 'Email',
  Checkbox = 'Checkbox',
  RadioGroup = 'RadioGroup',
  Dropdown = 'Dropdown',
  MultiSelect = 'MultiSelect',
  Initials = 'Initials',
  FullName = 'FullName',
  Signature = 'Signature',
  Mobile = 'Mobile',
  JobTitle = 'JobTitle',
  Company = 'Company',
  HijriDate = 'HijriDate',
  SignDate = 'SignDate',
  Barcode = 'Barcode',
  Image = 'Image',
  QrCode = 'QrCode',
}

export enum FieldGroup {
  Signing = 'signing',
  Identity = 'identity',
  Input = 'input',
  Choice = 'choice',
  Media = 'media',
}

export type FieldValue = string | boolean | null;

export { Validation };
export { TextDir };
export { TextAlign };
export { StampShape };
export { DateFormat };

export const FONT_FAMILIES = ['Almarai', 'Arial', 'Times New Roman', 'Helvetica', 'Georgia', 'Verdana', 'Courier New'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export interface Formatting {
  fontFamily: FontFamily;
  background: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  borderColor: string;
  align: TextAlign;
}

export const DEFAULT_FORMATTING: Formatting = {
  fontFamily: 'Almarai', background: '', bold: false, italic: false, underline: false, color: '#111827', borderColor: '', align: TextAlign.Start,
};

/**
 * A field on a page. Geometry is stored as fractions of the page (0..1), so it
 * doesn't depend on zoom, screen density or the size the page is shown at.
 */
export interface Field {
  id: string;
  type: FieldType;
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  required: boolean;
  readOnly: boolean;
  /** Id of the signer who fills this field. */
  signerId: string;
  /** Font size in PDF points; it scales with the page. */
  fontSize: number;
  value: FieldValue;
  options?: string[];
  formatting?: Formatting;
  /** Shown as the placeholder and as a tooltip to the signer. */
  hint?: string;
  defaultValue?: string;
  characterLimit?: number;
  validation?: Validation;
  dir?: TextDir;
  dateFormat?: DateFormat;
  stampShape?: StampShape;
  /** Position can't change (the original "moveable: false"). */
  locked?: boolean;
  /** Size can't change (the original "resizeable: false"). */
  fixedSize?: boolean;
  /** Filling one fills every field of the same type for the same signer. */
  forceApply?: boolean;
  /** Copies placed on several pages share this id (the original pageLocationUuId). */
  groupId?: string;
  /** Checkbox: ticked when the document is sent. */
  checkedByDefault?: boolean;
  /** Stamp: the department whose stamp is used. */
  departmentId?: string;
}

export const VALIDATION_PATTERNS: Record<Exclude<Validation, 'none'>, RegExp> = {
  email: EMAIL_PATTERN,
  mobileSa: SAUDI_MOBILE_PATTERN,
  number: NUMBER_PATTERN,
  nationalId: NATIONAL_ID_PATTERN,
  iban: SAUDI_IBAN_PATTERN,
};

/** Arabic-Indic digits and spaces don't count against validation. */
export function validate(field: Field): boolean {
  if (!field.validation || field.validation === 'none' || typeof field.value !== 'string' || !field.value) {
    return true;
  }
  const normalized = field.value.replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[\s-]/g, '');
  return VALIDATION_PATTERNS[field.validation].test(field.validation === 'email' ? field.value.trim() : normalized.toUpperCase());
}

/** Types whose value is usually the same everywhere, so force apply is on by default. */
export const FORCE_APPLY_DEFAULT = new Set<string>(['Initials', 'FullName', 'Stamp', 'Signature']);

export interface Signer {
  id: string;
  name: string;
  color: string;
}

export interface FieldMeta {
  type: FieldType;
  group: FieldGroup;
  icon: string;
  /** Default size as a fraction of an A4 page. */
  width: number;
  height: number;
  /** Filled automatically in sign mode. */
  auto?: boolean;
}

export const FIELD_META: Record<FieldType, FieldMeta> = {
  [FieldType.Signature]: { type: FieldType.Signature, group: FieldGroup.Signing, icon: 'signature', width: 0.26, height: 0.07 },
  [FieldType.Initials]: { type: FieldType.Initials, group: FieldGroup.Signing, icon: 'initials', width: 0.12, height: 0.05 },
  [FieldType.Stamp]: { type: FieldType.Stamp, group: FieldGroup.Signing, icon: 'stamp', width: 0.16, height: 0.11 },
  [FieldType.SignDate]: { type: FieldType.SignDate, group: FieldGroup.Signing, icon: 'calendar', width: 0.18, height: 0.035, auto: true },
  [FieldType.HijriDate]: { type: FieldType.HijriDate, group: FieldGroup.Signing, icon: 'moon', width: 0.2, height: 0.035, auto: true },
  [FieldType.FullName]: { type: FieldType.FullName, group: FieldGroup.Identity, icon: 'user', width: 0.24, height: 0.035 },
  [FieldType.Email]: { type: FieldType.Email, group: FieldGroup.Identity, icon: 'mail', width: 0.26, height: 0.035 },
  [FieldType.Mobile]: { type: FieldType.Mobile, group: FieldGroup.Identity, icon: 'phone', width: 0.2, height: 0.035 },
  [FieldType.JobTitle]: { type: FieldType.JobTitle, group: FieldGroup.Identity, icon: 'briefcase', width: 0.22, height: 0.035 },
  [FieldType.Company]: { type: FieldType.Company, group: FieldGroup.Identity, icon: 'building', width: 0.24, height: 0.035 },
  [FieldType.Text]: { type: FieldType.Text, group: FieldGroup.Input, icon: 'text', width: 0.24, height: 0.035 },
  [FieldType.Checkbox]: { type: FieldType.Checkbox, group: FieldGroup.Choice, icon: 'check', width: 0.035, height: 0.025 },
  [FieldType.RadioGroup]: { type: FieldType.RadioGroup, group: FieldGroup.Choice, icon: 'radio', width: 0.2, height: 0.06 },
  [FieldType.Dropdown]: { type: FieldType.Dropdown, group: FieldGroup.Choice, icon: 'chevrons', width: 0.22, height: 0.035 },
  [FieldType.MultiSelect]: { type: FieldType.MultiSelect, group: FieldGroup.Choice, icon: 'multi', width: 0.22, height: 0.08 },
  [FieldType.Image]: { type: FieldType.Image, group: FieldGroup.Media, icon: 'image', width: 0.2, height: 0.12 },
  [FieldType.QrCode]: { type: FieldType.QrCode, group: FieldGroup.Media, icon: 'qr', width: 0.1, height: 0.07 },
  [FieldType.Barcode]: { type: FieldType.Barcode, group: FieldGroup.Media, icon: 'barcode', width: 0.24, height: 0.05, auto: true },
};

export const FIELD_GROUPS: readonly FieldGroup[] = [
  FieldGroup.Signing,
  FieldGroup.Identity,
  FieldGroup.Input,
  FieldGroup.Choice,
  FieldGroup.Media,
];

export const DEFAULT_SIGNERS: readonly Signer[] = [
  { id: 's1', name: 'Sara Al-Harbi', color: '#7c3aed' },
  { id: 's2', name: 'Omar Haddad', color: '#0e7490' },
  { id: 's3', name: 'Lina Nasser', color: '#db2777' },
];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isFilled(field: Field): boolean {
  if (field.type === FieldType.Checkbox) {
    return field.value === true;
  }
  return field.value !== null && field.value !== '' && validate(field);
}

/**
 * A multi-select value is the chosen options, one per line (options are entered one per
 * line, so they never contain a line break). Kept as a string so values stay simple.
 */
export function multiValues(value: FieldValue): string[] {
  return typeof value === 'string' && value ? value.split('\n') : [];
}

let counter = 0;
export function newFieldId(): string {
  counter += 1;
  return `f${Date.now().toString(36)}${counter.toString(36)}`;
}

/** "1-3,5,6" → [1,2,3,5,6] within 1..max; null when the text isn't a valid range. */
export function parsePageRange(text: string, max: number): number[] | null {
  if (!/^[\d,\-\s]*$/.test(text) || !text.trim()) {
    return null;
  }
  const pages = new Set<number>();
  for (const part of text.split(',').map(p => p.trim()).filter(Boolean)) {
    const [a, b] = part.split('-').map(n => Number(n.trim()));
    if (!a || (part.includes('-') && !b)) {
      return null;
    }
    const [from, to] = b ? [Math.min(a, b), Math.max(a, b)] : [a, a];
    if (from < 1 || to > max) {
      return null;
    }
    for (let p = from; p <= to; p++) {
      pages.add(p);
    }
  }
  return [...pages].sort((x, y) => x - y);
}

export const DEPARTMENTS = [
  { id: 'd1', name: 'Legal', nameAr: 'الإدارة القانونية' },
  { id: 'd2', name: 'Finance', nameAr: 'الإدارة المالية' },
  { id: 'd3', name: 'Procurement', nameAr: 'المشتريات' },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A field's value as text for display and export (dates in their calendar and format). */
export function displayValue(field: Field, lang: string): string {
  const v = field.value;
  if (typeof v !== 'string') {
    return v === true ? '✓' : '';
  }
  if (field.type === FieldType.MultiSelect) {
    return multiValues(v).join(', ');
  }
  if ((field.type === FieldType.SignDate || field.type === FieldType.HijriDate) && ISO_DATE.test(v)) {
    const [y, mo, d] = v.split('-').map(Number);
    const date = new Date(y, mo - 1, d);
    const hijri = field.type === FieldType.HijriDate;
    const locale = `${lang === 'ar' ? 'ar' : 'en'}-SA-u-ca-${hijri ? 'islamic-umalqura' : 'gregory'}`;
    const format = field.dateFormat ?? 'd MMMM yyyy';
    if (format === 'd MMMM yyyy') {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    }
    const parts = Object.fromEntries(new Intl.DateTimeFormat(`${locale}-nu-latn`, { day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(date).map(p => [p.type, p.value]));
    return format === 'yyyy-MM-dd' ? `${parts['year']}-${parts['month']}-${parts['day']}` : `${parts['day']}/${parts['month']}/${parts['year']}`;
  }
  return v;
}
