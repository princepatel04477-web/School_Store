import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react';
// Stop a build whose API address is a file path. Git Bash on Windows silently rewrites
// VITE_API_URL=/api into "C:/Program Files/Git/api" for native programs, which produced a
// site that could not reach the server.
const apiUrl = process.env.VITE_API_URL;
if (apiUrl && !/^(\/|https?:\/\/)/.test(apiUrl)) {
  throw new Error(`VITE_API_URL must be "/api" or an http(s) URL, got "${apiUrl}"`);
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    fs: {
      allow: ['..'],
    },
    // The preview host is allowed explicitly so the sandboxed dev server can
    // be embedded; the browser only ever talks to this origin and the proxy
    // below forwards /api (and /media) to Django.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // With the slash, so /mediapipe (the on-phone pose model) is not sent to Django.
      '/media/': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
