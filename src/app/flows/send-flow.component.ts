import { EMAIL_PATTERN } from '../core/constants/validation.constants';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  channel, EnvelopeService, type Participant, ReminderFrequency, Role, SecurityCode, Verification,
} from '../core/envelope/envelope.service';
import { FieldStore } from '../core/fields/field-store.service';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { buildSampleContract, sampleFields } from '../core/pdf/sample-contract';
import { StudioState } from '../core/studio-state.service';
import { I18n, type Key } from '../core/ui/i18n';
import { Preferences } from '../core/ui/preferences.service';
import { SoundService } from '../core/ui/sound.service';
import { AlertService } from '../ui/alert.service';
import { Datepicker } from '../ui/datepicker.component';
import { Icon } from '../ui/icon.component';
import { Loader } from '../ui/loader.component';
import { Select, type SelectOption } from '../ui/select.component';
import { AuditTrail } from './audit-trail.component';
import { Provider } from '../core/enums/provider.enum';
import { View } from '../core/enums/view.enum';
import { Cue } from '../core/enums/cue.enum';
import { Mode } from '../core/enums/mode.enum';
import { AlertKind } from '../core/enums/alert-kind.enum';
import { ReminderMethod } from '../core/enums/reminder-method.enum';

type Step = 0 | 1 | 2 | 3 | 4;

/** The company side: upload → recipients → settings → prepare → review & send, then a live status board. */
@Component({
  selector: 'cs-send-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Select, Datepicker, Loader, AuditTrail],
  templateUrl: './send-flow.component.html',
  styleUrl: './flows.scss',
})
export class SendFlow {
  protected readonly ReminderMethod = ReminderMethod;
  protected readonly View = View;
  protected readonly Provider = Provider;
  protected readonly env = inject(EnvelopeService);
  protected readonly engine = inject(PdfEngine);
  protected readonly fields = inject(FieldStore);
  protected readonly state = inject(StudioState);
  readonly #prefs = inject(Preferences);
  protected readonly i18n = inject(I18n);
  readonly #sound = inject(SoundService);
  readonly #alerts = inject(AlertService);

  protected readonly step = signal<Step>(this.env.status() === 'draft' ? 0 : 4);
  protected readonly busy = signal(false);
  protected readonly dragId = signal<string | null>(null);
  protected readonly ar = computed(() => this.#prefs.lang() === 'ar');
  protected readonly tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  protected readonly channel = channel;

  protected readonly steps = computed(() => [
    this.i18n.t('fDocument'), this.i18n.t('fRecipients'), this.i18n.t('fSettings'),
    this.i18n.t('fPrepare'), this.i18n.t('fReviewSend'),
  ]);
  protected readonly roles = computed<SelectOption<Role>[]>(() => [
    { value: Role.Signer, label: this.i18n.t('fSigner'), icon: 'signature' },
    { value: Role.Approver, label: this.i18n.t('fApprover'), icon: 'review' },
    { value: Role.Viewer, label: this.i18n.t('fReceivesACopy'), icon: 'eye' },
  ]);
  protected readonly verifications = computed<SelectOption<Verification>[]>(() => [
    { value: Verification.Nafath, label: this.i18n.t('fNafath'), hint: this.i18n.t('fNationalSingleSignOn'), icon: 'lock' },
    { value: Verification.Sms, label: 'SMS OTP', icon: 'phone' },
    { value: Verification.Whatsapp, label: 'WhatsApp OTP', icon: 'phone' },
    { value: Verification.Email, label: this.i18n.t('fEmailOtp'), icon: 'mail' },
    { value: Verification.Authenticator, label: this.i18n.t('fAuthenticatorApp'), icon: 'lock' },
  ]);
  protected readonly frequencies = computed<SelectOption<ReminderFrequency>[]>(() => [
    { value: ReminderFrequency.Weekly, label: this.i18n.t('fWeekly') }, { value: ReminderFrequency.Monthly, label: this.i18n.t('fMonthly') },
    { value: ReminderFrequency.Quarterly, label: this.i18n.t('fEvery3Months') }, { value: ReminderFrequency.Semiannual, label: this.i18n.t('fEvery6Months') },
    { value: ReminderFrequency.Annual, label: this.i18n.t('fYearly') }, { value: ReminderFrequency.Custom, label: this.i18n.t('fEveryNDays') },
  ]);
  protected readonly codes = computed<{ id: SecurityCode; label: string }[]>(() => [
    { id: SecurityCode.Email, label: this.i18n.t('fEmail') }, { id: SecurityCode.Sms, label: 'SMS' }, { id: SecurityCode.Whatsapp, label: 'WhatsApp' },
    { id: SecurityCode.Authenticator, label: this.i18n.t('fAuthenticatorApp') },
  ]);

  protected readonly docValid = computed(() => this.engine.ready() && !!this.env.settings().title.trim() && !!this.env.settings().reference.trim());
  protected readonly recipientsValid = computed(() => {
    const list = this.env.participants();
    return list.length > 0 && list.every(p => p.name.trim() && EMAIL_PATTERN.test(p.email)) && list.some(p => p.role !== 'viewer');
  });
  protected readonly canNext = computed(() => [this.docValid(), this.recipientsValid(), true, true, true][this.step()]);

  protected go(step: number): void {
    this.step.set(step as Step);
    this.#sound.play(Cue.Tick);
  }

  protected next(): void {
    if (this.canNext() && this.step() < 4) {
      this.go(this.step() + 1);
    }
  }

  protected async useSample(): Promise<void> {
    this.busy.set(true);
    const bytes = await buildSampleContract(40);
    await this.engine.open(bytes, 'master-services-agreement-40p.pdf');
    this.fields.load(sampleFields(40));
    await this.env.attach(bytes, 'master-services-agreement-40p.pdf', 40);
    this.busy.set(false);
    this.#sound.play(Cue.Success);
  }

  protected async upload(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    this.busy.set(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.engine.open(bytes, file.name);
    this.fields.load([]);
    await this.env.attach(bytes, file.name, this.engine.pagesCount());
    this.env.updateSettings({ title: file.name.replace(/\.pdf$/i, '') });
    this.busy.set(false);
    this.#sound.play(Cue.Success);
  }

  protected update(p: Participant, change: Partial<Participant>): void {
    this.env.updateParticipant(p.id, change);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected toggleCode(id: SecurityCode, on: boolean): void {
    const current = this.env.settings().securityCodes;
    // The authenticator app can't be combined with the other channels (as in the original).
    const next = on ? (id === 'authenticator' ? ['authenticator'] : [...current.filter(c => c !== 'authenticator'), id]) : current.filter(c => c !== id);
    this.env.updateSettings({ securityCodes: next as SecurityCode[] });
  }

  /** Drag a recipient row by its handle to change the signing order. */
  protected dragStart(event: PointerEvent, id: string): void {
    const handle = event.currentTarget as HTMLElement;
    const list = handle.closest('.recipients') as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    this.dragId.set(id);
    const move = (e: PointerEvent) => {
      const rows = [...list.querySelectorAll<HTMLElement>('.recipient')];
      const over = rows.find(r => {
        const rect = r.getBoundingClientRect();
        return e.clientY > rect.top && e.clientY < rect.bottom;
      });
      const overId = over?.dataset['id'];
      if (overId && overId !== id) {
        const ids = this.env.participants().map(p => p.id);
        this.env.move(id, ids.indexOf(overId) > ids.indexOf(id) ? 1 : -1);
        this.#sound.play(Cue.Snap);
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      this.dragId.set(null);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  protected openEditor(): void {
    this.state.mode.set(Mode.Edit);
    this.state.view.set(View.Studio);
  }

  protected async send(): Promise<void> {
    const { confirmed } = await this.#alerts.open({
      kind: AlertKind.Question,
      title: this.i18n.t('fSendForSignature'),
      text: this.i18n.t('fInviteSummary', { people: this.env.actors(), fields: this.fields.fields().length }),
      confirmText: this.i18n.t('fSend'),
    });
    if (!confirmed) {
      return;
    }
    this.env.send();
    this.#sound.play(Cue.Whoosh);
    await this.#alerts.open({
      kind: AlertKind.Success,
      title: this.i18n.t('fSent'),
      text: this.i18n.t('fRecipientsWereNotifiedFollowTheir'),
      confirmText: this.i18n.t('fOpenStatusBoard'),
      cancelText: '',
    });
  }

  protected openJourney(): void {
    this.state.view.set(View.Journey);
  }

  protected statusLabel(p: Participant): string {
    const keys: Record<string, Key> = {
      draft: 'stDraft', waiting: 'stWaiting', invited: 'stInvited', viewed: 'stViewed',
      verified: 'stVerified', signed: 'stSigned', approved: 'stApproved', rejected: 'stRejected',
    };
    return keys[p.status] ? this.i18n.t(keys[p.status]) : p.status;
  }

  protected fieldsFor(p: Participant) {
    return this.env.fieldsFor(p.id);
  }

  protected readonly requiredCount = computed(() => this.fields.fields().filter(f => f.required).length);

  protected roleLabel(p: Participant): string {
    return this.roles().find(r => r.value === p.role)?.label ?? p.role;
  }

  protected shortHash(): string {
    const h = this.env.hash();
    return h ? `${h.slice(0, 16)}…${h.slice(-8)}` : '';
  }
}
