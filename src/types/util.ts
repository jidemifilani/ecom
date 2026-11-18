/**
 * Shared type utilities.
 */

/**
 * Makes properties whose type already includes `undefined` genuinely optional.
 *
 * Zod produces `{ phone: string | undefined }` for an optional field that goes
 * through `.transform()` -- a *required key* that may hold undefined. That is
 * correct but hostile to callers, who then have to write `phone: undefined`
 * explicitly for every field they do not care about.
 *
 * Applying this to the exported input types turns them into
 * `{ phone?: string | undefined }`, so a parsed Zod object still satisfies them
 * (every key is present) while hand-written callers -- services, scripts,
 * tests -- only state the fields they mean.
 */
export type Optionalise<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: T[K];
};
