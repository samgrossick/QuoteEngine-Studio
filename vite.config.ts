import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * A plain single-page build.
 *
 * The studio has no server, no database and no catalogue: it reads a file the
 * visitor picks and does everything else in the tab. That makes it a static
 * site, and building it as one keeps it deployable anywhere, GitHub Pages
 * included.
 */
export default defineConfig({
  // Relative asset URLs, so the build works from a subdirectory such as the
  // /repository-name/ path GitHub Pages serves a project site from.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@": here },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        // Modules shared with the QuoteEngine archive carry "use client" for
        // its React Server Components build. Here they are ordinary modules and
        // the directive is inert, so the warning is noise rather than a problem.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
  server: { port: 3100 },
  preview: { port: 3100 },
});
