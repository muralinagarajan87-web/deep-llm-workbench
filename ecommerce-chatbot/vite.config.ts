import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/rag": { target: "http://localhost:8000", changeOrigin: true, rewrite: (p) => p.replace(/^\/rag/, "") },
      "/eval": { target: "http://localhost:9000", changeOrigin: true, rewrite: (p) => p.replace(/^\/eval/, "") }
    }
  }
});
