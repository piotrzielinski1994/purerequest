import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Imported before it exists: the suite must fail RED on the missing module, not
// on a typo. Once find-bar.tsx ships these assertions pin the bar's contract.
import { FindBar } from "@/components/workspace/find-bar";

const noop = () => {};

describe("FindBar", () => {
  // TC-001 (AC-003) — behavior: the input reflects the query prop.
  it("should show the current query in its input if a query is passed", () => {
    render(
      <FindBar
        query="ada"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("ada");
  });

  // TC-001 (AC-003) — behavior: count reads the 1-based active/total (e.g. "1/3").
  it("should render the active/total count as 1/3 if activeIndex=1 total=3", () => {
    const { container } = render(
      <FindBar
        query="ada"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(container.textContent).toMatch(/1\s*\/\s*3/);
  });

  // TC-002 (AC-003) — behavior: an empty / no-match state reads 0/0.
  it("should render 0/0 if there are no matches", () => {
    const { container } = render(
      <FindBar
        query="zzz"
        onQueryChange={noop}
        activeIndex={0}
        total={0}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(container.textContent).toMatch(/0\s*\/\s*0/);
  });

  // TC-002 (AC-003) — behavior: prev/next are disabled when total===0.
  it("should disable the prev and next buttons if total is 0", () => {
    render(
      <FindBar
        query="zzz"
        onQueryChange={noop}
        activeIndex={0}
        total={0}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Previous match" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
  });

  // TC-002 (AC-003) — behavior: prev/next are enabled when there are matches.
  it("should enable the prev and next buttons if there are matches", () => {
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Previous match" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Next match" }),
    ).not.toBeDisabled();
  });

  // TC-003 (AC-003) — side-effect-contract: typing streams through onQueryChange.
  it("should call onQueryChange with the typed text if the user types", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    render(
      <FindBar
        query=""
        onQueryChange={onQueryChange}
        activeIndex={0}
        total={0}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Find" }), "x");

    expect(onQueryChange).toHaveBeenCalled();
    expect(onQueryChange.mock.calls.at(-1)?.[0]).toContain("x");
  });

  // TC-003 (AC-003) — side-effect-contract: the next button steps forward.
  it("should call onNext if the next button is clicked", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={onNext}
        onPrev={noop}
        onClose={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Next match" }));

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  // TC-003 (AC-003) — side-effect-contract: the previous button steps back.
  it("should call onPrev if the previous button is clicked", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={onPrev}
        onClose={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Previous match" }));

    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  // TC-004 (AC-003/AC-004) — side-effect-contract: Enter submits forwards.
  it("should call onSubmit with false if Enter is pressed in the input", () => {
    const onSubmit = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), {
      key: "Enter",
      shiftKey: false,
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(false);
  });

  // TC-004 (AC-003/AC-004) — side-effect-contract: Shift+Enter submits backwards.
  it("should call onSubmit with true if Shift+Enter is pressed in the input", () => {
    const onSubmit = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={noop}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), {
      key: "Enter",
      shiftKey: true,
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(true);
  });

  // TC-004 (AC-004) — side-effect-contract: Escape closes the bar.
  it("should call onClose if Escape is pressed in the input", () => {
    const onClose = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), {
      key: "Escape",
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // TC-004 (AC-004) — side-effect-contract: the close button dismisses the bar.
  it("should call onClose if the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <FindBar
        query="a"
        onQueryChange={noop}
        activeIndex={1}
        total={3}
        onNext={noop}
        onPrev={noop}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close find" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
