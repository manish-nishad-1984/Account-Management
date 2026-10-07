import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TextField } from "./index";

function Host({ required = false, min }: { required?: boolean; min?: string }) {
  const [value, setValue] = useState("2026-10-07");
  return (
    <>
      <TextField label="Order date" type="date" required={required} min={min} value={value} onChange={(event) => setValue(event.target.value)} />
      <output aria-label="state">{value}</output>
    </>
  );
}

describe("date field calendar", () => {
  it("opens a calendar on the current value, and choosing a day sets the field and the form's state", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    expect(screen.getByRole("dialog", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026-10-07" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "2026-10-15" }));

    expect(screen.getByLabelText("Order date")).toHaveValue("2026-10-15");
    expect(screen.getByLabelText("state")).toHaveTextContent("2026-10-15");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves between months and years", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "2026-11-03" }));
    expect(screen.getByLabelText("Order date")).toHaveValue("2026-11-03");

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await user.selectOptions(screen.getByLabelText("Year"), "2025");
    await user.click(screen.getByRole("button", { name: "2025-11-10" }));
    expect(screen.getByLabelText("state")).toHaveTextContent("2025-11-10");
  });

  it("offers Today, and Clear only when the field is not required", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Host />);
    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("state")).toHaveTextContent("");
    unmount();

    render(<Host required />);
    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  });

  it("will not pick a day before the minimum, and Escape closes it", async () => {
    const user = userEvent.setup();
    render(<Host min="2026-10-10" />);

    await user.click(screen.getByRole("button", { name: /open calendar/i }));
    expect(screen.getByRole("button", { name: "2026-10-09" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2026-10-10" })).toBeEnabled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
