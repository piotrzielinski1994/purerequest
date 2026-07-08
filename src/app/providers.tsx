import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { installContextMenuSuppressor } from "@/app/suppress-native-context-menu";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );

  // Kill the WebView's native right-click menu everywhere; Radix menus are
  // unaffected (they open via their own trigger handler).
  useEffect(() => installContextMenuSuppressor(document), []);

  return (
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider>{children}</HotkeysProvider>
    </QueryClientProvider>
  );
}
