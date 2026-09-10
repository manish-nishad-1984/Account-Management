import { ApiError } from "./api-client";

/**
 * What to tell the reader when a screen's data does not arrive.
 *
 * "The ledger could not be loaded" was shown for every failure, including a 403 —
 * and a refusal is not a failure. On production the two report screens answer
 * 403 for every user, because the forms behind them are deliberately inactive,
 * so the screen drew its filters, its export buttons and a red box inviting a
 * retry that could never succeed. The reader cannot tell "the server is having a
 * moment" from "you are not allowed to see this", and only one of those is worth
 * trying again.
 *
 * `subject` names the thing in lower case, as it would appear mid-sentence:
 * `describeLoadError(error, "the ledger")`.
 */
export function describeLoadError(error: unknown, subject: string): string {
  const status = error instanceof ApiError ? error.status : 0;

  if (status === 403) {
    return `You do not have permission to view ${subject}.`;
  }
  if (status === 401) {
    return "Your session has ended. Sign in again to continue.";
  }
  // A capital letter, because this one starts the sentence.
  const named = subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${named} could not be loaded.`;
}
