import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
var rootDir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
    base: "/ThingsboardPJ/",
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(rootDir, "./src"),
        },
    },
});
