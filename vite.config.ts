import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4444,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4445,
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
