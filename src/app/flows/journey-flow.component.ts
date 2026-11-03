import { EMAIL_PATTERN } from '../core/constants/validation.constants';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { channel, EnvelopeService, type Participant } from '../core/envelope/envelope.service';
import { FieldStore } from '../core/fields/field-store.service';
import { PdfEngine } from '../core/pdf/pdf-engine.service';
import { ExportService } from '../core/pdf/export.service';
import { StudioState } from '../core/studio-state.service';
import { I18n } from '../core/ui/i18n';
import { Preferences } from '../core/ui/preferences.service';
import { SoundService } from '../core/ui/sound.service';
import { AlertService } from '../ui/alert.service';
import { Icon } from '../ui/icon.component';
import { Loader } from '../ui/loader.component';
import { AuditTrail } from './audit-trail.component';
import { scheduleAfter, scheduleEvery, type Cancel } from '../core/utils/schedule.util';
import { ParticipantStatus } from '../core/enums/participant-status.enum';
import { Cue } from '../core/enums/cue.enum';
import { AlertKind } from '../core/enums/alert-kind.enum';
import { Mode } from '../core/enums/mode.enum';
import { View } from '../core/enums/view.enum';

type Stage = 'invite' | 'verify' | 'terms' | 'sign' | 'done';

const DEMO_CODE = '246810';

/**
 * The approval side for whoever's turn it is: invitation → identity check
 * (Nafath number matching or OTP) → terms → fill & sign → approve / decline / delegate.
 * Verification is simulated; nothing leaves the browser.
 */
@Component({
  selector: 'cs-journey-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Loader, AuditTrail],
  templateUrl: './journey-flow.component.html',
  styleUrl: './flows.scss',
})
export class JourneyFlow {
  protected readonly View = View;
  protected readonly env = inject(EnvelopeService);
  protected readonly fields = inject(FieldStore);
  protected readonly engine = inject(PdfEngine);
  readonly #export = inject(ExportService);
  readonly #state = inject(StudioState);
  readonly #prefs = inject(Preferences);
  protected readonly i18n = inject(I18n);
  readonly #sound = inject(SoundService);
  readonly #alerts = inject(AlertService);

  protected readonly ar = computed(() => this.#prefs.lang() === 'ar');
  protected readonly channel = channel;
  protected readonly demoCode = DEMO_CODE;
  protected readonly selectedId = signal<string | null>(null);
  protected readonly stage = signal<Stage>('invite');
  protected readonly otp = signal('');
  protected readonly otpError = signal(false);
  protected readonly nafathNumber = signal(0);
  protected readonly nafathChoices = signal<number[]>([]);
  protected readonly nafathSeconds = signal(0);
  protected readonly waiting = signal(false);
  protected readonly termsAccepted = signal(false);
  protected readonly termsRead = signal(false);
  protected readonly delegating = signal(false);
  readonly #destroyRef = inject(DestroyRef);
  #stopCountdown: Cancel = () => {};

  /** The participant being walked through: picked, or the first whose turn it is. */
  protected readonly person = computed<Participant | null>(() => {
    const list = this.env.participants();
    return list.find(p => p.id === this.selectedId()) ?? this.env.current()[0] ?? null;
  });
  protected readonly progress = computed(() => {
    const p = this.person();
    return p ? this.env.fieldsFor(p.id) : { total: 0, required: 0, filled: 0 };
  });
  protected readonly stages = computed(() => [
    { id: 'invite', label: this.i18n.t('fInvitation') },
    { id: 'verify', label: this.i18n.t('fVerify') },
    ...(this.env.settings().requireTerms ? [{ id: 'terms', label: this.i18n.t('fTerms') }] : []),
    { id: 'sign', label: this.i18n.t('fSign') },
    { id: 'done', label: this.i18n.t('fDone2') },
  ] as { id: Stage; label: string }[]);
  protected readonly stageIndex = computed(() => this.stages().findIndex(s => s.id === this.stage()));

  protected pick(id: string): void {
    this.selectedId.set(id);
    const p = this.env.participants().find(x => x.id === id);
    this.stage.set(p && ['signed', 'approved', 'rejected'].includes(p.status) ? 'done' : 'invite');
    this.termsAccepted.set(false);
    this.termsRead.set(false);
  }

  protected open(): void {
    const p = this.person();
    if (!p) {
      return;
    }
    this.env.setStatus(p.id, ParticipantStatus.Viewed);
    this.stage.set('verify');
    this.#sound.play(Cue.Whoosh);
    if (p.verification === 'nafath') {
      this.#startNafath();
    } else {
      this.env.log('System', `Sent ${channel(p.verification)}`, p.verification === 'email' ? p.email : p.mobile);
    }
  }

  /** Nafath: the signer picks the number shown here in the Nafath app (simulated). */
  #startNafath(): void {
    const n = 10 + Math.floor(Math.random() * 89);
    const others = new Set<number>([n]);
    while (others.size < 3) {
      others.add(10 + Math.floor(Math.random() * 89));
    }
    this.nafathNumber.set(n);
    this.nafathChoices.set([...others].sort(() => Math.random() - 0.5));
    this.nafathSeconds.set(120);
    this.#stopCountdown();
    this.#stopCountdown = scheduleEvery(1000, () => {
      this.nafathSeconds.update(s => Math.max(0, s - 1));
      if (!this.nafathSeconds()) {
        this.#stopCountdown();
      }
    }, this.#destroyRef);
  }

  protected restartNafath(): void {
    this.#startNafath();
  }

  protected chooseInApp(n: number): void {
    if (n !== this.nafathNumber()) {
      this.#sound.play(Cue.Error);
      void this.#alerts.open({ kind: AlertKind.Error, title: this.i18n.t('fWrongNumber'), text: this.i18n.t('fPickTheNumberShownOn'), cancelText: '' });
      return;
    }
    this.waiting.set(true);
    this.#stopCountdown();
    scheduleAfter(1400, () => {
      this.waiting.set(false);
      this.#verified('Nafath');
    }, this.#destroyRef);
  }

  protected typeOtp(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const digit = input.value.replace(/\D/g, '').slice(-1);
    input.value = digit;
    const chars = this.otp().padEnd(6, ' ').split('');
    chars[index] = digit || ' ';
    this.otp.set(chars.join('').trimEnd());
    this.otpError.set(false);
    if (digit) {
      (input.nextElementSibling as HTMLInputElement | null)?.focus();
    }
    if (this.otp().replace(/\s/g, '').length === 6) {
      this.verifyOtp();
    }
  }

  protected otpBack(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.value) {
      (input.previousElementSibling as HTMLInputElement | null)?.focus();
    }
  }

  protected pasteOtp(event: ClipboardEvent): void {
    const digits = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, 6);
    if (digits.length === 6) {
      event.preventDefault();
      this.otp.set(digits);
      this.verifyOtp();
    }
  }

  protected verifyOtp(): void {
    if (this.otp().replace(/\s/g, '') === DEMO_CODE) {
      this.#verified(channel(this.person()!.verification));
    } else {
      this.otpError.set(true);
      this.#sound.play(Cue.Error);
    }
  }

  protected resend(): void {
    const p = this.person();
    if (p) {
      this.env.log('System', `Resent ${channel(p.verification)}`);
      this.#sound.play(Cue.Pop);
    }
  }

  #verified(via: string): void {
    const p = this.person()!;
    this.env.setStatus(p.id, ParticipantStatus.Verified, via);
    this.#sound.play(Cue.Success);
    this.stage.set(this.env.settings().requireTerms ? 'terms' : 'sign');
  }

  protected onTermsScroll(event: Event): void {
    const el = event.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      this.termsRead.set(true);
    }
  }

  protected acceptTerms(): void {
    this.env.log(this.person()!.name, 'Accepted the terms and conditions');
    this.stage.set('sign');
    this.#sound.play(Cue.Success);
  }

  /** Opens the document in sign mode as this participant. */
  protected fillDocument(): void {
    const p = this.person()!;
    this.fields.activeSignerId.set(p.id);
    this.#state.mode.set(p.role === 'approver' ? Mode.Review : Mode.Sign);
    this.#state.view.set(View.Studio);
  }

  protected async approve(): Promise<void> {
    const p = this.person()!;
    const c = this.progress();
    if (p.role === 'signer' && c.filled < c.required) {
      await this.#alerts.open({
        kind: AlertKind.Warning,
        title: this.i18n.t('fSomeFieldsAreStillEmpty'),
        text: this.i18n.t('fRequiredLeft', { n: c.required - c.filled }),
        confirmText: this.i18n.t('fFillThemNow'),
        cancelText: this.i18n.t('fLater'),
      }).then(r => r.confirmed && this.fillDocument());
      return;
    }
    const { confirmed } = await this.#alerts.open({
      kind: AlertKind.Question,
      title: p.role === 'approver' ? this.i18n.t('fApproveTheAgreement') : this.i18n.t('fSendTheSignedAgreement'),
      text: this.i18n.t('fYourIdentityCheckAndThis'),
      confirmText: p.role === 'approver' ? this.i18n.t('fApprove') : this.i18n.t('fSignAndSend'),
    });
    if (!confirmed) {
      return;
    }
    this.env.setStatus(p.id, p.role === 'approver' ? ParticipantStatus.Approved : ParticipantStatus.Signed, `${c.filled} fields`);
    this.stage.set('done');
    this.#sound.play(Cue.Success);
  }

  protected async decline(): Promise<void> {
    const p = this.person()!;
    const { confirmed, value } = await this.#alerts.open({
      kind: AlertKind.Warning,
      danger: true,
      title: this.i18n.t('fDeclineTheAgreement'),
      text: this.i18n.t('fTheSenderSeesYourReason'),
      input: { label: this.i18n.t('fReason'), placeholder: this.i18n.t('fEGTheFeesIn') },
      confirmText: this.i18n.t('fDecline'),
    });
    if (confirmed) {
      this.env.setStatus(p.id, ParticipantStatus.Rejected, value);
      this.stage.set('done');
    }
  }

  protected delegate(form: HTMLFormElement): void {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    if (!name || !EMAIL_PATTERN.test(email) || !data.get('ack')) {
      this.#sound.play(Cue.Error);
      form.reportValidity();
      return;
    }
    this.env.delegate(this.person()!.id, name, email, String(data.get('note') ?? ''));
    this.delegating.set(false);
    this.stage.set('invite');
    this.#sound.play(Cue.Success);
  }

  protected async download(): Promise<void> {
    await this.#export.pdf();
  }

  protected readonly digits = [0, 1, 2, 3, 4, 5];
  protected readonly termNumbers = [1, 2, 3, 4, 5, 6];

  protected back(view: View.Send | View.Studio): void {
    this.#state.view.set(view);
  }
}
