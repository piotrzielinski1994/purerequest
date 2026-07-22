import { createTauriViteConfig } from "@pziel/pureui/vite";

export default createTauriViteConfig({
  appUrl: import.meta.url,
  devPort: 1430,
  hmrPort: 1421,
});
