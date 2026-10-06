import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("keeps focus in a field while typing, even when onClose is a new function every render", async () => {
    const user = userEvent.setup();
    function Host() {
      const [value, setValue] = useState("");
      return (
        <Modal open onClose={() => setValue("")} title="Units">
          <input aria-label="New unit" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
        </Modal>
      );
    }
    render(<Host />);

    const input = screen.getByLabelText("New unit");
    await user.click(input);
    await user.keyboard("Ton");

    expect(input).toHaveValue("Ton");
    expect(input).toHaveFocus();
  });
});
