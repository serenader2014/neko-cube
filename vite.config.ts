import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const backendTarget =
  process.env.VITE_API_TARGET ??
  `http://127.0.0.1:${process.env.LOCAL_DEV_MODE === "1" ? "36124" : "36123"}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@web": path.resolve(__dirname, "src/web"),
    },
  },
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 4000,
    proxy: {
      "/api": backendTarget,
      "/subscriptions": backendTarget,
    },
  },
});
