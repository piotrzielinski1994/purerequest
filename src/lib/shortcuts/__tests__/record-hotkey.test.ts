import { type Hotkey, matchesKeyboardEvent } from "@tanstack/hotkeys";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { eventToHotkey, useRecordHotkey } from "@/lib/shortcuts/record-hotkey";

// eventToHotkey is platform-explicit and pure, so these units pass a "mac"
// platform directly and use metaKey (⌘) - they do NOT depend on the jsdom
// platform. The recorder HOOK, by contrast, calls detectPlatform() internally
// (jsdom reports non-mac -> Mod resolves to Control, per learnings), so the
// hook tests dispatch Control-based events to land on the canonical "Mod+..".

describe("eventToHotkey", () => {
  // AC-009, TC-009 — behavior
  it("should record the physical combo if the key composes under mac Option", () => {
    // ⌘⌥P on macOS fires event.key="π" (composed) but event.code="KeyP".
    const hotkey = eventToHotkey(
      { metaKey: true, altKey: true, key: "π", code: "KeyP" },
      "mac",
    );

    expect(hotkey).toBe("Mod+Alt+P");
  });

  // AC-010, TC-010 — behavior
  it("should trust the layout key from event.key if the key is an ASCII letter", () => {
    // A remapped layout (Dvorak) can fire key="l" while the physical code is KeyP.
    // The matcher trusts event.key for ASCII letters, so the recorder must too:
    // "Mod+L", NOT "Mod+P".
    const hotkey = eventToHotkey(
      { metaKey: true, key: "l", code: "KeyP" },
      "mac",
    );

    expect(hotkey).toBe("Mod+L");
  });

  // E-4 — behavior
  it("should return null if the event is a Meta modifier-only press", () => {
    expect(
      eventToHotkey({ metaKey: true, key: "Meta", code: "MetaLeft" }, "mac"),
    ).toBeNull();
  });

  // E-4 — behavior
  it("should return null if the event is a Shift modifier-only press", () => {
    expect(
      eventToHotkey({ shiftKey: true, key: "Shift", code: "ShiftLeft" }, "mac"),
    ).toBeNull();
  });

  // E-4 — behavior
  it("should return null if the event is a Control modifier-only press", () => {
    expect(
      eventToHotkey(
        { ctrlKey: true, key: "Control", code: "ControlLeft" },
        "mac",
      ),
    ).toBeNull();
  });

  // E-4 — behavior
  it("should return null if the event is an Alt modifier-only press", () => {
    expect(
      eventToHotkey({ altKey: true, key: "Alt", code: "AltLeft" }, "mac"),
    ).toBeNull();
  });

  // AC-009 — behavior: Option-composed punctuation uses the PUNCTUATION_CODE_MAP fallback.
  it("should record the physical punctuation key if Option composes it on mac", () => {
    // ⌘⌥- on macOS fires event.key="–" (en-dash) but event.code="Minus".
    const hotkey = eventToHotkey(
      { metaKey: true, altKey: true, key: "–", code: "Minus" },
      "mac",
    );

    expect(hotkey).toBe("Mod+Alt+-");
  });

  // AC-009 — side-effect-contract: the recorder's output must be exactly what the
  // matcher fires on. Round-trip the SAME real event through eventToHotkey and
  // matchesKeyboardEvent to prove the recorder mirrors the matcher.
  it("should produce a hotkey the matcher fires on for a mac Option-composed letter", () => {
    const event = new KeyboardEvent("keydown", {
      metaKey: true,
      altKey: true,
      key: "π",
      code: "KeyP",
    });

    const hotkey = eventToHotkey(event, "mac");

    expect(hotkey).toBe("Mod+Alt+P");
    expect(matchesKeyboardEvent(event, hotkey as Hotkey, "mac")).toBe(true);
  });

  // AC-009 — side-effect-contract: same round-trip for the punctuation fallback path.
  it("should produce a hotkey the matcher fires on for a mac Option-composed punctuation", () => {
    const event = new KeyboardEvent("keydown", {
      metaKey: true,
      altKey: true,
      key: "–",
      code: "Minus",
    });

    const hotkey = eventToHotkey(event, "mac");

    expect(hotkey).toBe("Mod+Alt+-");
    expect(matchesKeyboardEvent(event, hotkey as Hotkey, "mac")).toBe(true);
  });
});

describe("useRecordHotkey", () => {
  // TC-011 — behavior
  it("should not be recording before startRecording is called", () => {
    const onRecord = vi.fn();
    const { result } = renderHook(() => useRecordHotkey({ onRecord }));

    expect(result.current.isRecording).toBe(false);
  });

  // TC-011 — behavior
  it("should be recording after startRecording is called", () => {
    const onRecord = vi.fn();
    const { result } = renderHook(() => useRecordHotkey({ onRecord }));

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
  });

  // AC-009, TC-011 — side-effect-contract: a composed combo keydown records the
  // canonical hotkey once. jsdom is non-mac, so Control (not Meta) yields "Mod+..".
  it("should call onRecord once with the canonical hotkey if a combo is pressed while recording", () => {
    const onRecord = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() =>
      useRecordHotkey({ onRecord, onCancel }),
    );

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          altKey: true,
          key: "π",
          code: "KeyP",
          bubbles: true,
        }),
      );
    });

    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith("Mod+Alt+P");
    expect(onCancel).not.toHaveBeenCalled();
  });

  // TC-011 — side-effect-contract: Escape aborts (onCancel), records nothing.
  it("should call onCancel and record nothing if Escape is pressed while recording", () => {
    const onRecord = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() =>
      useRecordHotkey({ onRecord, onCancel }),
    );

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        }),
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRecord).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });

  // E-4, TC-011 — behavior: a modifier-only keydown is ignored and recording continues.
  it("should ignore a modifier-only keydown and keep recording", () => {
    const onRecord = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() =>
      useRecordHotkey({ onRecord, onCancel }),
    );

    act(() => {
      result.current.startRecording();
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          key: "Control",
          code: "ControlLeft",
          bubbles: true,
        }),
      );
    });

    expect(onRecord).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(true);
  });
});
