import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Brand loader: a pen signing on a page, in the theme colours. */
@Component({
  selector: 'cs-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.aria-label]': 'label()' },
  templateUrl: './loader.component.html',
  styleUrl: './loader.component.scss',
})
export class Loader {
  readonly size = input(96);
  readonly label = input('');
}
