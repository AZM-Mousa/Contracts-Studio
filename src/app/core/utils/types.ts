/** The keys of T whose values are booleans (for switches bound to model flags). */
export type BooleanKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends boolean ? K : never }[keyof T];
