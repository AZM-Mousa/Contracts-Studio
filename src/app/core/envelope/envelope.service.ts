import { computed, inject, Service, signal } from '@angular/core';
import { FieldStore } from '../fields/field-store.service';
import { isFilled, type Signer } from '../fields/field.model';
import { Role } from '../enums/role.enum';
import { Verification } from '../enums/verification.enum';
import { SecurityCode } from '../enums/security-code.enum';
import { ReminderFrequency } from '../enums/reminder-frequency.enum';
import { Provider } from '../enums/provider.enum';
import { ParticipantStatus } from '../enums/participant-status.enum';
import { EnvelopeStatus } from '../enums/envelope-status.enum';
import { ReminderMethod } from '../enums/reminder-method.enum';

export { Role };
export { Verification };
export { SecurityCode };
export { ReminderFrequency };
export { Provider };
export { ParticipantStatus };
export { EnvelopeStatus };

export interface Participant extends Signer {
  email: string;
  mobile: string;
  role: Role;
  verification: Verification;
  /** Hours the participant has to act once it's their turn. */
  timeLimitHours: number;
  /** Reminder before the approval time runs out (the original "maximum approval time reminder"). */
  timeReminder: boolean;
  /** Signs, or only receives a copy. */
  needsToSign: boolean;
  allowDelegation: boolean;
  status: ParticipantStatus;
  delegatedTo?: string;
  reason?: string;
}

export interface AuditEvent {
  at: Date;
  actor: string;
  action: string;
  detail?: string;
}

export interface EnvelopeSettings {
  title: string;
  reference: string;
  description: string;
  message: string;
  sequential: boolean;
  graceDays: number;
  expiryEnabled: boolean;
  expiresAt: string;
  reminderMethod: ReminderMethod;
  reminderFrequency: ReminderFrequency;
  remindEveryDays: number;
  securityCodes: SecurityCode[];
  provider: Provider;
  requireTerms: boolean;
}

const COLORS = ['#7c3aed', '#0e7490', '#db2777', '#ea580c', '#16a34a', '#2563eb'];

/** One contract going out for signature: who, in what order, and everything that happened. */
@Service()
export class EnvelopeService {
  readonly #fields = inject(FieldStore);

  readonly fileName = signal('');
  readonly pages = signal(0);
  readonly hash = signal('');
  readonly status = signal<EnvelopeStatus>(EnvelopeStatus.Draft);
  readonly settings = signal<EnvelopeSettings>({
    title: 'Master Services Agreement',
    reference: 'MSA-2026-0418',
    description: 'Implementation and annual support services.',
    graceDays: 7,
    expiryEnabled: true,
    reminderMethod: ReminderMethod.Email,
    reminderFrequency: ReminderFrequency.Monthly,
    securityCodes: [SecurityCode.Sms],
    provider: Provider.Dga,
    message: 'Please review and sign the agreement. Contact us if anything is unclear.',
    sequential: true,
    expiresAt: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
    remindEveryDays: 2,
    requireTerms: true,
  });
  readonly participants = signal<Participant[]>([
    { id: 's1', name: 'Sara Al-Harbi', color: COLORS[0], email: 'sara@client.sa', mobile: '+966 50 123 4567', role: Role.Signer, verification: Verification.Nafath, timeLimitHours: 48, timeReminder: true, needsToSign: true, allowDelegation: false, status: ParticipantStatus.Draft },
    { id: 's2', name: 'Omar Haddad', color: COLORS[1], email: 'omar@supplier.sa', mobile: '+966 55 765 4321', role: Role.Signer, verification: Verification.Whatsapp, timeLimitHours: 48, timeReminder: true, needsToSign: true, allowDelegation: false, status: ParticipantStatus.Draft },
    { id: 's3', name: 'Lina Nasser', color: COLORS[2], email: 'lina@legal.sa', mobile: '+966 54 222 3344', role: Role.Approver, verification: Verification.Sms, timeLimitHours: 24, timeReminder: true, needsToSign: true, allowDelegation: false, status: ParticipantStatus.Draft },
  ]);
  readonly audit = signal<AuditEvent[]>([]);

  /** Whose turn it is: in order when sequential, everyone pending otherwise. */
  readonly current = computed(() => {
    const pending = this.participants().filter(p => p.role !== 'viewer' && !['signed', 'approved', 'rejected'].includes(p.status));
    return this.settings().sequential ? pending.slice(0, 1) : pending;
  });

  readonly done = computed(() => this.participants().filter(p => p.status === 'signed' || p.status === 'approved').length);
  readonly actors = computed(() => this.participants().filter(p => p.role !== 'viewer').length);

  constructor() {
    // The editor's signers are this envelope's participants.
    this.#fields.signers.set(this.participants());
  }

  async attach(bytes: Uint8Array, name: string, pages: number): Promise<void> {
    this.fileName.set(name);
    this.pages.set(pages);
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    this.hash.set([...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join(''));
    this.log('You', 'Uploaded the document', `${name} · ${pages} pages`);
  }

  updateSettings(change: Partial<EnvelopeSettings>): void {
    this.settings.update(s => ({ ...s, ...change }));
  }

  /** Hands the participant's turn to someone else (the original "delegate"). */
  delegate(id: string, name: string, email: string, note: string): void {
    const p = this.participants().find(x => x.id === id);
    if (!p) {
      return;
    }
    this.#setParticipants(this.participants().map(x => (x.id === id ? { ...x, name, email, delegatedTo: p.name, status: ParticipantStatus.Invited } : x)));
    this.log(p.name, `Delegated to ${name}`, note || email);
  }

  addParticipant(): void {
    const n = this.participants().length;
    this.#setParticipants([...this.participants(), {
      id: `p${Date.now().toString(36)}`, name: '', color: COLORS[n % COLORS.length], email: '', mobile: '+966 ',
      role: Role.Signer, verification: Verification.Nafath, timeLimitHours: 48, timeReminder: true, needsToSign: true, allowDelegation: false, status: ParticipantStatus.Draft,
    }]);
  }

  updateParticipant(id: string, change: Partial<Participant>): void {
    this.#setParticipants(this.participants().map(p => (p.id === id ? { ...p, ...change } : p)));
  }

  removeParticipant(id: string): void {
    this.#setParticipants(this.participants().filter(p => p.id !== id));
  }

  move(id: string, direction: -1 | 1): void {
    const list = [...this.participants()];
    const i = list.findIndex(p => p.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) {
      return;
    }
    [list[i], list[j]] = [list[j], list[i]];
    this.#setParticipants(list);
  }

  fieldsFor(id: string): { total: number; required: number; filled: number } {
    const fields = this.#fields.fields().filter(f => f.signerId === id);
    return { total: fields.length, required: fields.filter(f => f.required).length, filled: fields.filter(isFilled).length };
  }

  send(): void {
    this.status.set(EnvelopeStatus.Sent);
    const seq = this.settings().sequential;
    this.participants.update(list => list.map((p, i) => ({ ...p, status: p.role === Role.Viewer || !seq || i === 0 ? ParticipantStatus.Invited : ParticipantStatus.Waiting })));
    this.log('You', 'Sent for signature', seq ? 'In order, one after another' : 'To everyone at the same time');
    for (const p of this.participants().filter(p => p.status === 'invited')) {
      this.log('System', `Invited ${p.name}`, `${channel(p.verification)} · ${p.email}`);
    }
  }

  setStatus(id: string, status: ParticipantStatus, detail?: string): void {
    const p = this.participants().find(x => x.id === id);
    if (!p) {
      return;
    }
    this.participants.update(list => list.map(x => (x.id === id ? { ...x, status, reason: detail ?? x.reason } : x)));
    const labels: Partial<Record<ParticipantStatus, string>> = {
      viewed: 'Opened the document', verified: 'Verified identity', signed: 'Signed', approved: 'Approved', rejected: 'Rejected',
    };
    this.log(p.name, labels[status] ?? status, detail);
    if (status === 'rejected') {
      this.status.set(EnvelopeStatus.Rejected);
      return;
    }
    if (status === 'signed' || status === 'approved') {
      this.#advance();
    }
  }

  reset(): void {
    this.status.set(EnvelopeStatus.Draft);
    this.audit.set([]);
    this.participants.update(list => list.map(p => ({ ...p, status: ParticipantStatus.Draft, reason: undefined })));
  }

  log(actor: string, action: string, detail?: string): void {
    this.audit.update(list => [...list, { at: new Date(), actor, action, detail }]);
  }

  #advance(): void {
    const next = this.participants().find(p => p.status === ParticipantStatus.Waiting);
    if (this.settings().sequential && next) {
      this.participants.update(list => list.map(p => (p.id === next.id ? { ...p, status: ParticipantStatus.Invited } : p)));
      this.log('System', `Invited ${next.name}`, `${channel(next.verification)} · ${next.email}`);
    }
    if (this.done() === this.actors()) {
      this.status.set(EnvelopeStatus.Completed);
      this.log('System', 'Completed', 'Everyone has signed or approved. The signed PDF and certificate are ready.');
    }
  }

  #setParticipants(list: Participant[]): void {
    this.participants.set(list);
    this.#fields.signers.set(list);
  }
}

export function channel(v: Verification): string {
  return { nafath: 'Nafath', sms: 'SMS OTP', whatsapp: 'WhatsApp OTP', email: 'Email OTP', authenticator: 'Authenticator app' }[v];
}
