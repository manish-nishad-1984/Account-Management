import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./index";

/** Client request, 18 Sep 2026: the breadcrumb names the page; the page shows no title. */
describe("PageHeader", () => {
  it("keeps the page name as a hidden heading and does not show the description", () => {
    render(<PageHeader title="Purchase Orders" description="What has been ordered from a supplier" />);

    expect(screen.getByRole("heading", { level: 1, name: "Purchase Orders" })).toHaveClass("sr-only");
    expect(screen.queryByText("What has been ordered from a supplier")).not.toBeInTheDocument();
  });

  it("still shows the screen's actions", () => {
    render(<PageHeader title="Companies" actions={<button type="button">Add company</button>} />);
    expect(screen.getByRole("button", { name: "Add company" })).toBeVisible();
  });
});
