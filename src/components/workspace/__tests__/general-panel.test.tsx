import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneralPanel } from "@/components/workspace/config-panels";
import type { ConfigScope } from "@/lib/workspace/model";
import type { ResolvedValue } from "@/lib/workspace/resolve";

const DEFAULT_EFFECTIVE: ResolvedValue<number> = {
  value: 30000,
  from: { scopeId: "default", scopeName: "default" },
};

const INHERITED_EFFECTIVE: ResolvedValue<number> = {
  value: 7000,
  from: { scopeId: "folder-1", scopeName: "Parent" },
};

// A stateful harness so a controlled GeneralPanel reflects committed edits: the
// spy records every call AND feeds the config back, so userEvent typing
// accumulates like it does behind the real draft seam.
function StatefulPanel({
  initialConfig = {},
  effectiveTimeout = DEFAULT_EFFECTIVE,
  onChange,
}: {
  initialConfig?: ConfigScope;
  effectiveTimeout?: ResolvedValue<number>;
  onChange: (config: ConfigScope) => void;
}) {
  const [config, setConfig] = useState<ConfigScope>(initialConfig);
  return (
    <GeneralPanel
      config={config}
      effectiveTimeout={effectiveTimeout}
      onChange={(next) => {
        setConfig(next);
        onChange(next);
      }}
    />
  );
}

describe("GeneralPanel timeout field", () => {
  // side-effect-contract: typing a positive integer commits it as `timeoutMs`
  // (spreading the rest of the scope) through onChange.
  it("should call onChange with the parsed timeoutMs if a positive integer is typed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StatefulPanel
        initialConfig={{ variables: [{ key: "a", value: "b" }] }}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText(/timeout/i), "5000");

    expect(onChange).toHaveBeenLastCalledWith({
      variables: [{ key: "a", value: "b" }],
      timeoutMs: 5000,
    });
  });

  // side-effect-contract: clearing an own value removes the `timeoutMs` key
  // entirely (inherit), leaving the rest of the scope untouched.
  it("should call onChange with no timeoutMs key if an own value is cleared", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StatefulPanel
        initialConfig={{ variables: [{ key: "a", value: "b" }], timeoutMs: 5000 }}
        onChange={onChange}
      />,
    );

    await user.clear(screen.getByLabelText(/timeout/i));

    const last = onChange.mock.calls.at(-1)?.[0] as ConfigScope;
    expect("timeoutMs" in last).toBe(false);
    expect(last).toEqual({ variables: [{ key: "a", value: "b" }] });
  });

  // behavior: an own timeoutMs is shown as the input's value (not just the placeholder).
  it("should display the own timeoutMs as the input value", () => {
    render(<StatefulPanel initialConfig={{ timeoutMs: 5000 }} onChange={vi.fn()} />);

    expect(screen.getByLabelText(/timeout/i)).toHaveDisplayValue("5000");
  });

  // behavior: unset scope + default origin -> empty input, placeholder shows the
  // effective value + `default`.
  it("should show the default effective value and origin as placeholder if unset", () => {
    render(
      <StatefulPanel
        initialConfig={{}}
        effectiveTimeout={DEFAULT_EFFECTIVE}
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(/timeout/i);
    expect(input).toHaveDisplayValue("");
    expect(input).toHaveAttribute("placeholder", "30000 (default)");
  });

  // behavior: unset scope + inherited origin -> placeholder shows the inherited
  // value + the ancestor scope name.
  it("should show the inherited value and scope name as placeholder if inherited", () => {
    render(
      <StatefulPanel
        initialConfig={{}}
        effectiveTimeout={INHERITED_EFFECTIVE}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/timeout/i)).toHaveAttribute(
      "placeholder",
      "7000 (from Parent)",
    );
  });
});

describe("GeneralPanel rejects invalid entries", () => {
  // side-effect-contract: a non-positive / non-integer / non-numeric entry is
  // rejected - no onChange call ever writes a `timeoutMs`.
  it.each(["0", "-5", "abc", "1.5", "1.", "1e3", " "])(
    "should never write a timeoutMs if %s is entered",
    (value) => {
      const onChange = vi.fn();
      render(
        <GeneralPanel
          config={{}}
          effectiveTimeout={DEFAULT_EFFECTIVE}
          onChange={onChange}
        />,
      );

      const input = screen.getByLabelText(/timeout/i);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);

      const wroteTimeout = onChange.mock.calls.some(
        ([config]) => (config as ConfigScope).timeoutMs !== undefined,
      );
      expect(wroteTimeout).toBe(false);
    },
  );

  // side-effect-contract: typing a fractional value character-by-character never
  // commits a non-integer. The controlled input drops the `.` (the `1.` string is
  // rejected whole, not parsed to 1), so the field lands on `15` and every
  // committed value stays a whole number.
  it("should never write a fractional timeoutMs if a decimal is typed key by key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatefulPanel initialConfig={{}} onChange={onChange} />);

    await user.type(screen.getByLabelText(/timeout/i), "1.5");

    const written = onChange.mock.calls.map(
      ([config]) => (config as ConfigScope).timeoutMs,
    );
    expect(written.every((v) => v === undefined || Number.isInteger(v))).toBe(
      true,
    );
    expect(onChange).toHaveBeenLastCalledWith({ timeoutMs: 15 });
  });
});
