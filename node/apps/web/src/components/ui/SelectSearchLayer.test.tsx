import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectSearchLayer, matchesSearch } from "./SelectSearchLayer";
import { SelectField } from "./fields";
import { Modal } from "./Modal";

/** A search box in every dropdown (client, 20 Oct 2026). */
const SUPPLIERS = [
  { value: "", label: "All suppliers" },
  { value: "s1", label: "AL BURHAN PIPES" },
  { value: "s2", label: "SHAH ENTERPRISE" },
  { value: "s3", label: "INDIA STEEL" },
  { value: "s4", label: "SHREE PIPES & FITTINGS" },
];

function Screen({ onPick = () => {} }: { onPick?: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <SelectSearchLayer />
      <SelectField
        label="Supplier"
        value={value}
        options={SUPPLIERS}
        onChange={(event) => {
          setValue(event.target.value);
          onPick(event.target.value);
        }}
      />
      <output>{value || "none"}</output>
    </>
  );
}

describe("SelectSearchLayer", () => {
  it("opens a searchable list on click, and the pick reaches the select's own onChange", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Screen onPick={onPick} />);

    fireEvent.mouseDown(screen.getByLabelText("Supplier"));
    const search = await screen.findByRole("combobox", { name: /search supplier/i });
    expect(search).toHaveFocus();
    const list = () => within(screen.getByRole("listbox"));
    expect(list().getAllByRole("option")).toHaveLength(5);

    await user.type(search, "pipes");
    expect(list().getAllByRole("option").map((option) => option.textContent)).toEqual([
      "AL BURHAN PIPES",
      "SHREE PIPES & FITTINGS",
    ]);
    expect(screen.getByText("2 of 5")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith("s4");
    expect(screen.getByRole("status")).toHaveTextContent("s4");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Supplier")).toHaveFocus();
  });

  it("starts the search with a letter typed on the closed select", async () => {
    render(<Screen />);
    const select = screen.getByLabelText("Supplier");
    select.focus();
    fireEvent.keyDown(select, { key: "i" });
    const search = await screen.findByRole("combobox", { name: /search supplier/i });
    expect(search).toHaveValue("i");
  });

  it("matches every word in any order", () => {
    expect(matchesSearch("AL BURHAN PIPES", "pipe al")).toBe(true);
    expect(matchesSearch("AL BURHAN PIPES", "steel")).toBe(false);
    expect(matchesSearch("Anything", "  ")).toBe(true);
  });

  it("picks with the mouse, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Screen />);
    fireEvent.mouseDown(screen.getByLabelText("Supplier"));
    const search = await screen.findByRole("combobox", { name: /search supplier/i });
    await user.type(search, "zzz");
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    await user.clear(search);
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("INDIA STEEL"));
    expect(screen.getByRole("status")).toHaveTextContent("s3");
  });

  it("leaves the browser's own select working — what every form test does", async () => {
    const user = userEvent.setup();
    render(<Screen />);
    await user.selectOptions(screen.getByLabelText("Supplier"), "s2");
    expect(screen.getByRole("status")).toHaveTextContent("s2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape without closing the dialog behind it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <SelectSearchLayer />
        <Modal open onClose={onClose} title="Payment">
          <SelectField label="Method" defaultValue="" options={[{ value: "", label: "Cash" }, { value: "u", label: "UPI" }]} />
        </Modal>
      </>,
    );
    fireEvent.mouseDown(screen.getByLabelText("Method"));
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
