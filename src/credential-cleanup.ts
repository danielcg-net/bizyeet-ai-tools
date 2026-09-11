const committedCleanupFailure = Symbol("committed-credential-cleanup");
const uncertainPersistence = Symbol("uncertain-credential-persistence");

/** Identifies a write whose persistence and retirement could not be confirmed. */
export const isUncertainCredentialPersistence = (error: unknown): boolean =>
  error instanceof Error && error.cause === uncertainPersistence;

/** Keeps uncertain storage distinct from both proven commitment and retirement. */
export const uncertainCredentialPersistenceError = (): Error =>
  new Error("Credential persistence and retirement could not be confirmed. Stop commands, revoke the connection in dashboard settings, and repair credential storage before signing in again.", { cause: uncertainPersistence });

/** Identifies cleanup failure after a credential operation completed. */
export const isCommittedCredentialCleanupFailure = (error: unknown): boolean =>
  error instanceof Error && error.cause === committedCleanupFailure;

/** Marks completion without retaining secret-bearing filesystem errors. */
export const committedCredentialCleanupError = (): Error =>
  new Error("Credential storage completed, but cleanup failed. Check storage and abandoned locks before retrying.", { cause: committedCleanupFailure });

/** Preserves completion evidence across cleanup, including nested cleanup failures. */
export const withCredentialCleanup = async <T>(update: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> => {
  const outcome = await Promise.resolve().then(update).then(
    (value) => ({ ok: true, value } as const),
    (error: unknown) => ({ ok: false, error } as const),
  );
  try { await cleanup(); }
  catch {
    if (!outcome.ok && isUncertainCredentialPersistence(outcome.error)) throw uncertainCredentialPersistenceError();
    if (outcome.ok || isCommittedCredentialCleanupFailure(outcome.error)) throw committedCredentialCleanupError();
    throw new Error("Credential update and lock cleanup failed.", { cause: outcome.error });
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};
