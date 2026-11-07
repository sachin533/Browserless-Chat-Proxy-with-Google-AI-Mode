import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // Vite blocks requests whose Host header it does not recognise.  When the
    // dev server is published through a Cloudflare Tunnel the Host is the
    // public hostname, so the check is relaxed for this local tool.
    allowedHosts: true,
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
