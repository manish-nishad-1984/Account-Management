import { createContext, useContext } from "react";

/**
 * "This form has the whole page, not a box."
 *
 * Set by `RecordPage` and read by `FormSection`, so a form laid out for a 48rem
 * dialog can spread across a 1600px content area without any screen being
 * rewritten. Twelve forms use `FormSection`; none of them knows this exists.
 *
 * WHY A CONTEXT RATHER THAN THE LAYOUT ITSELF. `useRecordLayout()` would answer
 * "page" for the whole application, including a `FormSection` rendered somewhere
 * that is not a record — a filter panel, a settings block. Today every one of the
 * twelve is inside a `FormDialog`, so the two signals agree; this one keeps
 * agreeing when that stops being true.
 *
 * False outside a provider, which is every modal, every side panel and every
 * existing test: a form that knows nothing about this renders exactly as it did.
 */
export const RecordSurfaceContext = createContext(false);

export const useWideSurface = (): boolean => useContext(RecordSurfaceContext);
