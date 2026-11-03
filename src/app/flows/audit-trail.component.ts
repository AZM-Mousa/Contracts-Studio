import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EnvelopeService } from '../core/envelope/envelope.service';
import { I18n } from '../core/ui/i18n';
import { Preferences } from '../core/ui/preferences.service';
import { Icon } from '../ui/icon.component';

/** Every action on the envelope, newest first, with the document fingerprint. */
@Component({
  selector: 'cs-audit-trail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './audit-trail.component.html',
  styleUrl: './audit-trail.component.scss',
})
export class AuditTrail {
  protected readonly env = inject(EnvelopeService);
  readonly #prefs = inject(Preferences);
  protected readonly i18n = inject(I18n);
  protected readonly ar = computed(() => this.#prefs.lang() === 'ar');
  protected readonly events = computed(() => [...this.env.audit()].reverse());

  protected format(date: Date): string {
    return date.toLocaleString(this.ar() ? 'ar-SA-u-ca-gregory' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
  }
}
