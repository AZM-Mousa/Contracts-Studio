import { computed, Service, signal } from '@angular/core';
import { DEFAULT_FORMATTING, DEFAULT_SIGNERS, FIELD_META, FORCE_APPLY_DEFAULT, isFilled, newFieldId, type Field, FieldType, type Rect, type Signer } from './field.model';
import type { DetectedField } from './field-detector';
import { boundsOf, clamp, findFreeSpot, overlapsAny } from './geometry';
import { Align } from '../enums/align.enum';
import { Validation } from '../enums/validation.enum';
import { TextDir } from '../enums/text-dir.enum';
import { StampShape } from '../enums/stamp-shape.enum';
import { Axis } from '../enums/axis.enum';

const HISTORY_LIMIT = 100;

export { Align };

@Service()
export class FieldStore {
  readonly signers = signal<readonly Signer[]>(DEFAULT_SIGNERS);
  readonly activeSignerId = signal(DEFAULT_SIGNERS[0].id);
  readonly fields = signal<readonly Field[]>([]);
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly collisionAvoidance = signal(true);
  /** Set when fields couldn't be placed because there was no free space; the UI reports it. */
  readonly noSpace = signal<{ skipped: number; movedToPage?: number; at: number } | null>(null);

  readonly #past = signal<readonly (readonly Field[])[]>([]);
  readonly #future = signal<readonly (readonly Field[])[]>([]);
  #clipboard: Field[] = [];

  readonly canUndo = computed(() => this.#past().length > 0);
  readonly canRedo = computed(() => this.#future().length > 0);

  /** Fields grouped by page, so each page layer reads only its own. */
  readonly byPage = computed(() => {
    const map = new Map<number, Field[]>();
    for (const field of this.fields()) {
      let list = map.get(field.page);
      if (!list) {
        list = [];
        map.set(field.page, list);
      }
      list.push(field);
    }
    return map;
  });

  /** Reading order: page, then top to bottom, then start to end. */
  readonly ordered = computed(() =>
    [...this.fields()].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x),
  );

  readonly selected = computed(() => {
    const ids = this.selection();
    return this.fields().filter(f => ids.has(f.id));
  });

  readonly requiredForActiveSigner = computed(() =>
    this.ordered().filter(f => f.required && f.signerId === this.activeSignerId()),
  );

  readonly progress = computed(() => {
    const required = this.requiredForActiveSigner();
    return { done: required.filter(isFilled).length, total: required.length };
  });

  signer(id: string): Signer | undefined {
    return this.signers().find(s => s.id === id);
  }

  load(fields: readonly Field[]): void {
    this.fields.set(separateOverlaps(fields));
    this.#past.set([]);
    this.#future.set([]);
    this.selection.set(new Set());
  }

  /** Adds a field near (x, y); if the page is full, on the next page with room. Null when no page has room. */
  create(type: FieldType, page: number, x: number, y: number, pagesCount = page): Field | null {
    const meta = FIELD_META[type];
    const field: Field = {
      id: newFieldId(),
      type,
      page,
      x: clamp(x - meta.width / 2, 0, 1 - meta.width),
      y: clamp(y - meta.height / 2, 0, 1 - meta.height),
      width: meta.width,
      height: meta.height,
      label: '',
      required: true,
      readOnly: false,
      signerId: this.activeSignerId(),
      fontSize: 10,
      value: null,
      options: type === FieldType.RadioGroup || type === FieldType.Dropdown || type === FieldType.MultiSelect ? ['Option 1', 'Option 2'] : undefined,
      formatting: { ...DEFAULT_FORMATTING },
      validation: type === 'Email' ? Validation.Email : type === 'Mobile' ? Validation.MobileSa : Validation.None,
      dir: TextDir.Auto,
      forceApply: FORCE_APPLY_DEFAULT.has(type),
      stampShape: type === 'Stamp' ? StampShape.Circle : undefined,
    };
    for (let offset = 0; offset < pagesCount; offset++) {
      const target = ((page - 1 + offset) % pagesCount) + 1;
      const placed = this.#placed({ ...field, page: target });
      if (placed) {
        this.#commit([...this.fields(), placed]);
        this.select([placed.id]);
        if (target !== page) {
          this.noSpace.set({ skipped: 0, movedToPage: target, at: Date.now() });
        }
        return placed;
      }
    }
    this.noSpace.set({ skipped: 1, at: Date.now() });
    return null;
  }

  /**
   * Moves fields by a step unless that would make one cover another field
   * (arrow-key nudging never pushes into a neighbour).
   */
  nudge(ids: Iterable<string>, dx: number, dy: number): boolean {
    const set = new Set(ids);
    const moved = this.fields().filter(f => set.has(f.id) && !f.locked && !f.readOnly).map(f => ({
      ...f,
      x: clamp(f.x + dx, 0, 1 - f.width),
      y: clamp(f.y + dy, 0, 1 - f.height),
    }));
    const blocked = moved.some(m => overlapsAny(m, (this.byPage().get(m.page) ?? []).filter(o => !set.has(o.id))));
    if (blocked || !moved.length) {
      return false;
    }
    const byId = new Map(moved.map(m => [m.id, m]));
    this.#commit(this.fields().map(f => byId.get(f.id) ?? f));
    return true;
  }

  /** Applies a change to one or more fields as a single undo step. */
  update(ids: Iterable<string>, change: (field: Field) => Partial<Field>, resolve = false): void {
    const set = new Set(ids);
    if (!set.size) {
      return;
    }
    let skipped = 0;
    const next = this.fields().map(field => {
      if (!set.has(field.id)) {
        return field;
      }
      const updated = { ...field, ...change(field) };
      if (!resolve) {
        return updated;
      }
      const placed = this.#placed(updated, set);
      if (!placed) {
        skipped++;
        return field;
      }
      return placed;
    });
    if (skipped) {
      this.noSpace.set({ skipped, at: Date.now() });
    }
    this.#commit(next);
  }

  /**
   * Value changes in sign mode; same undo stack. With force apply, every field
   * of the same type for the same signer gets the value too (e.g. initials on every page).
   */
  setValue(id: string, value: Field['value']): number {
    const field = this.fields().find(f => f.id === id);
    if (!field) {
      return 0;
    }
    // Copies of one field across pages always share a value; force apply extends it to every field of the type.
    const ids = this.fields()
      .filter(f => f.id === id || (field.groupId && f.groupId === field.groupId)
        || (field.forceApply && f.forceApply && f.type === field.type && f.signerId === field.signerId && !f.readOnly))
      .map(f => f.id);
    this.update(ids, () => ({ value }));
    return ids.length;
  }

  /**
   * Adds suggested fields (from text detection). A suggestion next to an existing
   * field of the same type is skipped; the rest go to the nearest free spot.
   */
  addDetected(found: readonly DetectedField[]): number {
    const added: Field[] = [];
    for (const d of this.freshDetections(found)) {
      const meta = FIELD_META[d.type];
      this.#pushPlaced(added, {
        id: newFieldId(), type: d.type, page: d.page, x: d.x, y: d.y, width: d.width, height: d.height,
        label: '', required: true, readOnly: false, signerId: this.activeSignerId(), fontSize: 10, value: null,
        formatting: { ...DEFAULT_FORMATTING }, dir: TextDir.Auto, forceApply: FORCE_APPLY_DEFAULT.has(d.type),
        validation: meta.type === FieldType.Email ? Validation.Email : meta.type === FieldType.Mobile ? Validation.MobileSa : Validation.None,
      });
    }
    if (added.length) {
      this.#commit([...this.fields(), ...added]);
      this.select(added.map(a => a.id));
    }
    return added.length;
  }

  /** The suggestions that don't already have a field of the same type right there. */
  freshDetections(found: readonly DetectedField[]): DetectedField[] {
    const fresh: DetectedField[] = [];
    const near = (a: Rect, b: Rect) => Math.hypot(a.x - b.x, a.y - b.y) < 0.06;
    for (const d of found) {
      const taken = (this.byPage().get(d.page) ?? []).some(e => e.type === d.type && near(e, d))
        || fresh.some(e => e.page === d.page && e.type === d.type && near(e, d));
      if (!taken) {
        fresh.push(d);
      }
    }
    return fresh;
  }

  /** Copies formatting (font, colours, size, direction, alignment) from one field to others. */
  copyFormat(fromId: string, toIds: Iterable<string>): void {
    const from = this.fields().find(f => f.id === fromId);
    if (!from) {
      return;
    }
    this.update([...toIds].filter(id => id !== fromId), () => ({
      formatting: { ...(from.formatting ?? DEFAULT_FORMATTING) },
      fontSize: from.fontSize,
      dir: from.dir,
    }));
  }

  /**
   * Places linked copies of each field on the given pages (the original field location:
   * all pages, last page, or a custom range). Copies share a group id.
   */
  placeOnPages(ids: Iterable<string>, pages: readonly number[]): number {
    const set = new Set(ids);
    const groups = new Map<string, string>();
    const copies: Field[] = [];
    let wanted = 0;
    const updated = this.fields().map(f => {
      if (!set.has(f.id)) {
        return f;
      }
      const groupId = f.groupId ?? newFieldId();
      groups.set(f.id, groupId);
      const existing = new Set(this.fields().filter(o => o.groupId && o.groupId === f.groupId).map(o => o.page));
      for (const page of pages) {
        if (page !== f.page && !existing.has(page)) {
          wanted++;
          this.#pushPlaced(copies, { ...f, id: newFieldId(), page, groupId, value: null });
        }
      }
      return { ...f, groupId };
    });
    this.#commit([...updated, ...copies]);
    this.#reportSkipped(copies.length, wanted);
    return copies.length;
  }

  remove(ids: Iterable<string>): void {
    const set = new Set(ids);
    if (!set.size) {
      return;
    }
    this.#commit(this.fields().filter(f => !set.has(f.id)));
    this.selection.set(new Set());
  }

  duplicate(ids: Iterable<string>): void {
    const copies: Field[] = [];
    for (const f of this.fields().filter(o => new Set(ids).has(o.id))) {
      this.#pushPlaced(copies, { ...f, id: newFieldId(), groupId: undefined, x: clamp(f.x + 0.02, 0, 1 - f.width), y: clamp(f.y + 0.02, 0, 1 - f.height), value: null });
    }
    this.#reportSkipped(copies.length, new Set(ids).size);
    this.#commit([...this.fields(), ...copies]);
    this.select(copies.map(c => c.id));
  }

  /** How many fields are on the clipboard (for enabling Paste). */
  readonly clipboardCount = signal(0);

  copy(): void {
    this.#clipboard = this.selected().map(f => ({ ...f }));
    this.clipboardCount.set(this.#clipboard.length);
  }

  /** Pastes on a page; with `at`, the copied group's top-left corner goes to that spot. */
  paste(page: number, at?: { x: number; y: number }): void {
    if (!this.#clipboard.length) {
      return;
    }
    const box = boundsOf(this.#clipboard);
    const dx = at ? at.x - box.x : 0;
    const dy = at ? at.y - box.y : 0;
    const copies: Field[] = [];
    for (const f of this.#clipboard) {
      const x = Math.min(1 - f.width, Math.max(0, f.x + dx));
      const y = Math.min(1 - f.height, Math.max(0, f.y + dy));
      this.#pushPlaced(copies, { ...f, id: newFieldId(), page, x, y, value: null, groupId: undefined });
    }
    this.#reportSkipped(copies.length, this.#clipboard.length);
    this.#commit([...this.fields(), ...copies]);
    this.select(copies.map(c => c.id));
  }

  align(mode: Align): void {
    const selected = this.selected();
    if (selected.length < 2) {
      return;
    }
    const b = boundsOf(selected);
    this.update(selected.map(f => f.id), f => {
      switch (mode) {
        case 'left': return { x: b.x };
        case 'center': return { x: b.x + b.width / 2 - f.width / 2 };
        case 'right': return { x: b.x + b.width - f.width };
        case 'top': return { y: b.y };
        case 'middle': return { y: b.y + b.height / 2 - f.height / 2 };
        case 'bottom': return { y: b.y + b.height - f.height };
        default: return {};
      }
    }, true);
  }

  distribute(axis: Axis): void {
    const selected = [...this.selected()].sort((a, b) => a[axis] - b[axis]);
    if (selected.length < 3) {
      return;
    }
    const size = axis === 'x' ? 'width' : 'height';
    const first = selected[0];
    const last = selected[selected.length - 1];
    const total = selected.reduce((sum, f) => sum + f[size], 0);
    const gap = (last[axis] + last[size] - first[axis] - total) / (selected.length - 1);
    let cursor = first[axis];
    const positions = new Map<string, number>();
    for (const f of selected) {
      positions.set(f.id, cursor);
      cursor += f[size] + gap;
    }
    this.update(positions.keys(), f => ({ [axis]: positions.get(f.id)! }), true);
  }

  select(ids: Iterable<string>): void {
    this.selection.set(new Set(ids));
  }

  toggleSelect(id: string): void {
    const next = new Set(this.selection());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selection.set(next);
  }

  undo(): void {
    const past = this.#past();
    if (!past.length) {
      return;
    }
    this.#future.set([this.fields(), ...this.#future()]);
    this.fields.set(past[past.length - 1]);
    this.#past.set(past.slice(0, -1));
    this.#pruneSelection();
  }

  redo(): void {
    const [next, ...rest] = this.#future();
    if (!next) {
      return;
    }
    this.#past.set([...this.#past(), this.fields()]);
    this.fields.set(next);
    this.#future.set(rest);
    this.#pruneSelection();
  }

  #commit(next: readonly Field[]): void {
    this.#past.set([...this.#past(), this.fields()].slice(-HISTORY_LIMIT));
    this.#future.set([]);
    this.fields.set(next);
  }

  /** The field moved to the nearest free spot on its page, or null when the page is full. */
  #placed(field: Field, ignore: ReadonlySet<string> = new Set([field.id])): Field | null {
    const others = (this.byPage().get(field.page) ?? []).filter(f => !ignore.has(f.id) && f.id !== field.id);
    const spot = findFreeSpot(field, others);
    return spot ? { ...field, ...spot } : null;
  }

  #pushPlaced(list: Field[], field: Field): void {
    const others = [...(this.byPage().get(field.page) ?? []), ...list.filter(p => p.page === field.page)];
    const spot = findFreeSpot(field, others);
    if (spot) {
      list.push({ ...field, ...spot });
    }
  }

  #reportSkipped(placed: number, wanted: number): void {
    if (placed < wanted) {
      this.noSpace.set({ skipped: wanted - placed, at: Date.now() });
    }
  }

  #pruneSelection(): void {
    const ids = new Set(this.fields().map(f => f.id));
    this.selection.set(new Set([...this.selection()].filter(id => ids.has(id))));
  }
}

/**
 * Moves any field that covers an earlier one on the same page to the nearest free
 * spot (or leaves it if the page is full). Fields that don't overlap are untouched.
 */
function separateOverlaps(fields: readonly Field[]): readonly Field[] {
  const byPage = new Map<number, Field[]>();
  let changed = false;
  const result = fields.map(field => {
    const placed = byPage.get(field.page) ?? [];
    byPage.set(field.page, placed);
    let next = field;
    if (overlapsAny(field, placed)) {
      const spot = findFreeSpot(field, placed);
      if (spot) {
        next = { ...field, ...spot };
        changed = true;
      }
    }
    placed.push(next);
    return next;
  });
  return changed ? result : fields;
}
