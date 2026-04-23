import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const gatewayTarget = process.env.CONSTRUCT_GATEWAY_URL ?? "http://127.0.0.1:42617";

// Build-only config. The web dashboard is served by the Rust gateway
// via rust-embed. Run `npm run build` then `cargo build` to update.
export default defineConfig({
  base: "/_app/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": gatewayTarget,
      "/admin": gatewayTarget,
      "/pair": gatewayTarget,
      "/health": gatewayTarget,
      "/ws": {
        target: gatewayTarget,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
  },
});
