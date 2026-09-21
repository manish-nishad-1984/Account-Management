import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormDialog } from "./FormDialog";
import { FormSection } from "./fields";
import { TextField } from "./index";
import { StaticRecordLayout, type RecordLayout } from "../../contexts/RecordLayoutContext";

/**
 * A FORM LAID OUT FOR A DIALOG, GIVEN A WHOLE PAGE.
 *
 * The record page was capped at 48rem, so on a 1920px screen every field sat in
 * the left third with the rest of the window empty — the complaint that started
 * this. The fix is not a wider cap: it is `FormSection` measuring the box it is
 * actually in and laying out two, three or four columns to fill it.
 *
 * THESE ASSERT ON CLASSES, WHICH IS UNUSUAL HERE AND DELIBERATE. jsdom loads no
 * stylesheet, so `gridTemplateColumns` is empty and column COUNT cannot be
 * observed at all in this environment — a test claiming to check it would be
 * checking nothing. The classes are the mechanism, so they are what can honestly
 * be pinned; the counts were measured in a real browser instead (2 in a dialog
 * and a side panel, 4 on a page at 1920px).
 *
 * What matters most is the second half: the dialog and the panel must come out
 * of this completely unchanged.
 */

const renderIn = (layout: RecordLayout) =>
  render(
    <StaticRecordLayout layout={layout}>
      <FormDialog open onClose={vi.fn()} onSubmit={vi.fn()} title="Bansal Traders">
        <FormSection title="Identity" columns={2}>
          <TextField label="Supplier name" />
          <TextField label="GST number" />
        </FormSection>
      </FormDialog>
    </StaticRecordLayout>,
  );

/** The section element, found through its own heading. */
const section = () => screen.getByText("Identity").closest("section") as HTMLElement;

/**
 * The grid of fields: the section's last child.
 *
 * It was "the element right after the heading", which stopped being true when
 * the heading grew an icon and became a flex row wrapping the <h3> - the h3's
 * next sibling is now its own description. The grid has always been the last
 * thing in the section, and that does not depend on how the heading is built.
 */
const grid = () => section().lastElementChild as HTMLElement;

describe("a form section on a full page", () => {
  it("measures its own container rather than the window", () => {
    renderIn("page");
    // `@container` is what makes the `@sm`/`@3xl`/`@5xl` steps resolve against
    // this section instead of the viewport — the same form is 28rem wide in a
    // panel and 1600px wide here at one unchanged window size.
    expect(section().className).toContain("@container");
    expect(grid().className).toMatch(/@sm:grid-cols-2/);
    expect(grid().className).toMatch(/@5xl:grid-cols-4/);
  });

  /**
   * Two columns from `@sm` (384px) up, and that floor is load bearing rather
   * than taste: 25 fields across 12 forms say `sm:col-span-2` to mean "take the
   * whole row", which is a VIEWPORT rule this grid cannot see. In a one-column
   * grid on a window 640px or wider they would span into an implicit second
   * column and overflow the section.
   */
  it("never drops below two columns, so sm:col-span-2 cannot overflow", () => {
    renderIn("page");
    expect(grid().className).not.toMatch(/(^|\s)grid-cols-1(\s|$)/);
  });

  it("becomes its own card, because one white sheet 1600px wide reads as a wall", () => {
    renderIn("page");
    expect(section().className).toContain("bg-white");
    expect(section().className).toContain("rounded-xl");
  });
});

describe("the same form in a box", () => {
  it.each(["modal", "split"] as const)("is untouched in the %s layout", (layout) => {
    renderIn(layout);

    // Exactly what it was before the page layout existed: viewport columns, a
    // hairline rule, no card and no container.
    expect(grid().className).toContain("sm:grid-cols-2");
    expect(grid().className).not.toContain("@sm:grid-cols-2");
    expect(section().className).toContain("border-t");
    expect(section().className).not.toContain("@container");
    expect(section().className).not.toContain("bg-white");
  });
});
