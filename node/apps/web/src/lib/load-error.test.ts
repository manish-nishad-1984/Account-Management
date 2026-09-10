import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { describeLoadError } from "./load-error";

/**
 * A REFUSAL IS NOT A FAILURE, and saying so cost real confusion.
 *
 * Both report screens answer 403 for every user on the live site, because the
 * forms behind them are deliberately inactive. The screens drew their filters,
 * their export buttons and a red box reading "The ledger could not be loaded" —
 * which describes a server having a moment, invites a retry, and is wrong on
 * both counts.
 */
describe("describeLoadError", () => {
  it("says a 403 is a permission problem, not a loading problem", () => {
    const message = describeLoadError(new ApiError(403, "Forbidden"), "the ledger");

    expect(message).toBe("You do not have permission to view the ledger.");
    expect(message).not.toContain("could not be loaded");
  });

  it("tells someone whose session ended what to do about it", () => {
    expect(describeLoadError(new ApiError(401, "Unauthorized"), "the ledger")).toBe(
      "Your session has ended. Sign in again to continue.",
    );
  });

  it("keeps the plain wording for a genuine failure", () => {
    expect(describeLoadError(new ApiError(500, "Boom"), "the ledger")).toBe(
      "The ledger could not be loaded.",
    );
  });

  /** A network error is not an ApiError and has no status at all. */
  it("handles an error that never reached the server", () => {
    expect(describeLoadError(new TypeError("Failed to fetch"), "the ledger")).toBe(
      "The ledger could not be loaded.",
    );
  });

  it("capitalises the subject only when it starts the sentence", () => {
    expect(describeLoadError(new ApiError(500, "x"), "the balance summary")).toBe(
      "The balance summary could not be loaded.",
    );
    expect(describeLoadError(new ApiError(403, "x"), "the balance summary")).toBe(
      "You do not have permission to view the balance summary.",
    );
  });
});
