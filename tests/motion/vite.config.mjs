import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const source = (file) => fileURLToPath(new URL(file, import.meta.url));
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: [
      { find: "@tanstack/react-router", replacement: source("./router.tsx") },
      { find: "@/hooks/useHospitalData", replacement: source("./data.ts") },
      { find: "@/lib/hospital.functions", replacement: source("./actions.ts") },
      { find: "@/lib/lastDischarge.functions", replacement: source("./actions.ts") },
      { find: "@", replacement: source("../../src") },
    ],
  },
  server: { host: "0.0.0.0", port: 4173, strictPort: true },
});
