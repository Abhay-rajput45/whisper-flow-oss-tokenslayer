import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";
import path from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        overlay: path.resolve(__dirname, "overlay.html"),
        settings: path.resolve(__dirname, "settings.html"),
      },
    },
  },
  plugins: [
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            target: "node22",
            rollupOptions: {
              external: ["electron", "dotenv", "ws"],
            },
          },
          resolve: {
            // Prefer Node resolution so `ws` is not the browser stub
            conditions: ["node", "import", "module", "default"],
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
              output: {
                entryFileNames: "preload.mjs",
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});
