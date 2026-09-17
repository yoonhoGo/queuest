import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "@queuest/pixel-character": fileURLToPath(
        new URL("../../packages/pixel-character/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { strictPort: true },
});
