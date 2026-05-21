import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    host: "0.0.0.0",
    // File-watching strategy. Bind-mount FS events are unreliable on Windows
    // and macOS Docker Desktop, so polling is the safe default there. Native
    // Linux can opt out via CHOKIDAR_USEPOLLING=false to save ~1-2% CPU.
    watch: {
      usePolling: process.env.CHOKIDAR_USEPOLLING !== "false",
      interval: 300
    },
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
