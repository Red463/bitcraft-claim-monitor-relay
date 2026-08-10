import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.PORT ?? 19428);
const localApiTarget = `http://127.0.0.1:${process.env.LOCAL_API_PORT ?? 19430}`;

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("react-dom") ||
            id.includes("/react/") ||
            id.includes("\\react\\") ||
            id.includes("/scheduler/") ||
            id.includes("\\scheduler\\")
          ) return "vendor-react";
          if (id.includes("lucide-react")) return "vendor-icons";
          return "vendor";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: localApiTarget,
        changeOrigin: true,
      },
    },
  },
});
