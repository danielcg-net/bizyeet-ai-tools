const committedCleanupFailure = Symbol("committed-credential-cleanup");

/** Identifies cleanup failure after a credential operation completed. */
export const isCommittedCredentialCleanupFailure = (error: unknown): boolean =>
  error instanceof Error && error.cause === committedCleanupFailure;

/** Marks completion without retaining secret-bearing filesystem errors. */
export const committedCredentialCleanupError = (): Error =>
  new Error("Credential storage completed, but cleanup failed. Check storage and abandoned locks before retrying.", { cause: committedCleanupFailure });

/** Preserves completion evidence across cleanup, including nested cleanup failures. */
export const withCredentialCleanup = async <T>(update: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> => {
  const outcome = await update().then(
    (value) => ({ ok: true, value } as const),
    (error: unknown) => ({ ok: false, error } as const),
  );
  try { await cleanup(); }
  catch {
    if (outcome.ok || isCommittedCredentialCleanupFailure(outcome.error)) throw committedCredentialCleanupError();
    throw new Error("Credential update and lock cleanup failed.", { cause: outcome.error });
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};
