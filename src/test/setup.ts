import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// A few tests opt into `@vitest-environment node` (build-level guards with no
// DOM). The DOM stubs below reference jsdom globals, so skip them when there is
// no document - guarding here keeps those node tests from crashing on import.
const hasDom = typeof document !== "undefined";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (hasDom && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// CodeMirror's autocompletion measures caret coords via Range.getClientRects /
// textRange().getClientRects, which jsdom leaves undefined (throws "not a
// function" the moment the JS-script editor dispatches a change). Stub both so a
// CM editor with autocomplete mounts + edits under jsdom.
if (hasDom && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}
if (hasDom && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    }) as DOMRect;
}

// Radix Select/Popover open via pointer-capture APIs jsdom doesn't implement;
// stub them so a test can open a select and click an option.
if (hasDom && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (hasDom && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (hasDom && !Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// sonner's <Toaster theme="system"> reads window.matchMedia on mount, which
// jsdom doesn't implement; stub it so a mounted Toaster (e.g. the __root layout
// in the bootstrap integration test) doesn't throw.
if (hasDom && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
