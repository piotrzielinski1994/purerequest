import {
  detectPlatform,
  isModifierKey,
  normalizeHotkeyFromParsed,
  normalizeKeyName,
  PUNCTUATION_CODE_MAP,
  rawHotkeyToParsedHotkey,
} from "@tanstack/hotkeys";
import { useCallback, useEffect, useRef, useState } from "react";

type Platform = "mac" | "windows" | "linux";

// The subset of a KeyboardEvent the recorder reads. Accepting a plain bag (not
// only a real KeyboardEvent) keeps eventToHotkey unit-testable without the DOM.
type KeyEventLike = {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  key: string;
  code?: string;
};

function isAsciiLetter(value: string): boolean {
  return /^[A-Za-z]$/.test(value);
}

// The physical key the combo should record, mirroring matchesKeyboardEvent so a
// recorded hotkey is exactly what the matcher will later fire on. macOS Option
// composes the key into a special char (⌥P -> "π", ⌥- -> "–") while event.code
// still reports the physical key, so for anything but an ASCII letter we prefer
// event.code. ASCII letters trust event.key so a remapped layout (Dvorak) records
// what the matcher matches, not the physical position.
function physicalKey(event: KeyEventLike): string | null {
  const key: string = normalizeKeyName(event.key);
  // isModifierKey's predicate is `key is keyof typeof MODIFIER_ALIASES`, whose
  // key type is `string`; using it directly as a guard narrows the else-branch
  // to `never`. Read it as a plain boolean instead.
  const isModifier: boolean = isModifierKey(key);
  if (isModifier) {
    return null;
  }
  if (isAsciiLetter(key)) {
    return key.toUpperCase();
  }
  const code = event.code ?? "";
  if (code.startsWith("Key")) {
    const letter = code.slice(3);
    if (isAsciiLetter(letter)) {
      return letter.toUpperCase();
    }
  }
  if (code.startsWith("Digit")) {
    const digit = code.slice(5);
    if (/^[0-9]$/.test(digit)) {
      return digit;
    }
  }
  if (code in PUNCTUATION_CODE_MAP) {
    return PUNCTUATION_CODE_MAP[code];
  }
  if (key === "Dead" || key.length === 0) {
    return null;
  }
  return key;
}

// Convert a keydown into the canonical hotkey string, or null for a modifier-only
// / unusable press (the recorder ignores those and keeps listening).
export function eventToHotkey(
  event: KeyEventLike,
  platform: Platform = detectPlatform(),
): string | null {
  const key = physicalKey(event);
  if (key === null) {
    return null;
  }
  const parsed = rawHotkeyToParsedHotkey(
    {
      key,
      ctrl: event.ctrlKey ?? false,
      shift: event.shiftKey ?? false,
      alt: event.altKey ?? false,
      meta: event.metaKey ?? false,
    },
    platform,
  );
  return normalizeHotkeyFromParsed(parsed, platform);
}

type RecordHotkeyOptions = {
  onRecord: (hotkey: string) => void;
  onCancel?: () => void;
};

type RecordHotkeyApi = {
  isRecording: boolean;
  startRecording: () => void;
  cancelRecording: () => void;
};

// An own recorder replacing @tanstack/react-hotkeys' useHotkeyRecorder, which
// builds the hotkey from event.key alone: macOS Option composes the key into a
// special char the registry rejects as unknown, so a recorded ⌘⌥P silently
// reverted to the default. This records via eventToHotkey (event.code-aware), so
// the stored hotkey is exactly what the matcher fires on.
export function useRecordHotkey(options: RecordHotkeyOptions): RecordHotkeyApi {
  const [isRecording, setIsRecording] = useState(false);
  // Mirror the latest callbacks into a ref so the keydown listener (bound once
  // per recording session) always calls the current onRecord/onCancel without
  // re-subscribing on every render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const startRecording = useCallback(() => setIsRecording(true), []);
  const cancelRecording = useCallback(() => setIsRecording(false), []);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setIsRecording(false);
        optionsRef.current.onCancel?.();
        return;
      }
      const hotkey = eventToHotkey(event);
      if (hotkey === null) {
        return;
      }
      setIsRecording(false);
      optionsRef.current.onRecord(hotkey);
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isRecording]);

  return { isRecording, startRecording, cancelRecording };
}
