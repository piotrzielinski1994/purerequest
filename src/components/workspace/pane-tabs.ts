// A synthetic tab id for the Settings tab so it lives in the ordered `openRequestIds`
// list alongside real requests - giving it drag/keyboard reorder, close, and context-
// menu parity for free. It is NOT a request id: guard request-map lookups against it,
// and it is dropped from the persisted open-tab ids (reopens fresh each launch).
export const SETTINGS_TAB_ID = "__settings__";

export const PANE_TABS_LIST =
  "h-full! w-fit gap-0 rounded-none bg-transparent p-0";

export const PANE_TABS_TRIGGER =
  "h-full rounded-none border-0 border-r border-r-border px-3 after:hidden hover:bg-accent data-[state=active]:-mb-px data-[state=active]:self-stretch data-[state=active]:bg-accent data-[state=active]:!shadow-[inset_0_-1px_0_0_var(--primary)] data-[state=active]:after:opacity-0 dark:data-[state=active]:bg-accent";
