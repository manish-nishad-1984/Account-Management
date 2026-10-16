import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LETTERHEAD_MAX_MM, readLetterheadSpace, useLetterheadSpace } from "./letterhead";

/**
 * SPACE FOR A LETTERHEAD (client, 17 Oct 2026): remembered in the browser, never
 * negative, never absurd.
 */
describe("letterhead space", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts at nothing", () => {
    expect(readLetterheadSpace()).toEqual({ topMm: 0, bottomMm: 0 });
  });

  it("is remembered between visits", () => {
    const first = renderHook(() => useLetterheadSpace());
    act(() => first.result.current[1]({ topMm: 45 }));
    act(() => first.result.current[1]({ bottomMm: 20 }));
    first.unmount();

    const again = renderHook(() => useLetterheadSpace());
    expect(again.result.current[0]).toEqual({ topMm: 45, bottomMm: 20 });
  });

  it("keeps the figure between 0 and the most a page can spare", () => {
    const hook = renderHook(() => useLetterheadSpace());
    act(() => hook.result.current[1]({ topMm: -10 }));
    expect(hook.result.current[0].topMm).toBe(0);
    act(() => hook.result.current[1]({ topMm: 9999 }));
    expect(hook.result.current[0].topMm).toBe(LETTERHEAD_MAX_MM);
    act(() => hook.result.current[1]({ topMm: Number.NaN }));
    expect(hook.result.current[0].topMm).toBe(0);
  });

  it("ignores a stored value that is not a number", () => {
    window.localStorage.setItem("letterhead-space", '{"topMm":"lots","bottomMm":12.6}');
    expect(readLetterheadSpace()).toEqual({ topMm: 0, bottomMm: 13 });
  });
});
