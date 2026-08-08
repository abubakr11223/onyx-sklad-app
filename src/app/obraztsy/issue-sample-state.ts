// Plain module (NO "use server") — types/helpers for issueSampleAction.
// Next.js: every export from a "use server" file must be an async function.
// Keep state shape + empty initial state here so SaleForm and the action share one contract.

/** State shape for useActionState(issueSampleAction). */
export type IssueSampleFormState = {
  errors: Record<string, string>;
  conflict: string | null;
};

/** Initial / empty state for useActionState — sync helper, not a Server Action. */
export function emptyIssueSampleState(): IssueSampleFormState {
  return { errors: {}, conflict: null };
}
