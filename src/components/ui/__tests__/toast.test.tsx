import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider, useToast } from "@/components/ui/toast";

function Trigger() {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show("Copied to clipboard")}>
      go
    </button>
  );
}

describe("ToastProvider", () => {
  // behavior: show() surfaces the message
  it("should display the message if show is called", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "go" }));

    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });

  // behavior: useToast outside a provider is a no-op (does not throw)
  it("should not throw if useToast is used without a provider", async () => {
    const user = userEvent.setup();
    render(<Trigger />);

    await expect(
      user.click(screen.getByRole("button", { name: "go" })),
    ).resolves.not.toThrow();
  });
});

// AC-002 - the richer `show` signature adds an optional { persistent, action }
// options bag and returns a handle { id, update, dismiss } so the update checker
// can flip a persistent toast's label to "Downloading… NN%".
describe("ToastProvider persistent + action toasts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // behavior: a persistent toast is NOT auto-dismissed at 2500ms (TC-005 support)
  it("should keep a persistent toast past the 2500ms auto-dismiss", () => {
    vi.useFakeTimers();

    function PersistentTrigger() {
      const { show } = useToast();
      return (
        <button
          type="button"
          onClick={() => show("Update available: v0.2.0", { persistent: true })}
        >
          go
        </button>
      );
    }

    render(
      <ToastProvider>
        <PersistentTrigger />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "go" }).click();
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getByText("Update available: v0.2.0")).toBeInTheDocument();
  });

  // behavior: an action toast renders a button with the given label and the click
  // fires the provided onClick
  it("should render the action button and fire onClick when clicked", async () => {
    const onClick = vi.fn();

    function ActionTrigger() {
      const { show } = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            show("Update available: v0.2.0", {
              persistent: true,
              action: { label: "Update now", onClick },
            })
          }
        >
          go
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ActionTrigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "go" }));
    await user.click(screen.getByRole("button", { name: /update now/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // behavior: the × close control removes the toast (TC-006 support)
  it("should remove the toast when the dismiss control is clicked", async () => {
    function DismissTrigger() {
      const { show } = useToast();
      return (
        <button
          type="button"
          onClick={() => show("Update available: v0.2.0", { persistent: true })}
        >
          go
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DismissTrigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByText("Update available: v0.2.0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dismiss|close/i }));

    expect(
      screen.queryByText("Update available: v0.2.0"),
    ).not.toBeInTheDocument();
  });

  // behavior: the returned handle can update the toast's message text
  it("should update the toast message via the returned handle", async () => {
    function UpdatingTrigger() {
      const { show } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            const handle = show("Update available: v0.2.0", {
              persistent: true,
            });
            handle.update("Downloading… 42%");
          }}
        >
          go
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <UpdatingTrigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "go" }));

    expect(screen.getByText("Downloading… 42%")).toBeInTheDocument();
    expect(
      screen.queryByText("Update available: v0.2.0"),
    ).not.toBeInTheDocument();
  });

  // behavior: existing string-only callers keep auto-dismissing at 2500ms
  it("should still auto-dismiss a bare string toast at 2500ms", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "go" }).click();
    });
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument();
  });
});
