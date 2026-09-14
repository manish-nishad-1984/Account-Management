import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./index";

/**
 * A Button inside a form must not submit it unless it says so.
 *
 * HTML makes a `<button>` a submit button by default. Until 14 Sep 2026 this
 * component passed that default through, so the Add product and Remove line
 * buttons on the invoice and order forms submitted the whole document — saving
 * it when it was valid.
 */
describe("Button", () => {
  it("does not submit the form it sits in", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onClick = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick}>Add a line</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add a line" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still submits when it is a submit button", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
