import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

const renderDialog = (typeToConfirm?: string) => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} title="Delete" body="Sure?" typeToConfirm={typeToConfirm} />,
  );
  return onConfirm;
};

describe("ConfirmDialog typeToConfirm", () => {
  it("keeps Delete disabled until the text is typed, ignoring case and spaces", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog("GENT/26-27/57");
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/Type GENT\/26-27\/57/), "gent/26-27/5");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/Type GENT/), "7 ");
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("asks for nothing when no text is required", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
