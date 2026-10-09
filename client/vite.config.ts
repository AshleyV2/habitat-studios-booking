import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative asset URLs: the server injects <base href="{BASE_PATH}/"> into index.html,
// so one build works at a domain root or under a path such as /book.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4010' },
      '/health': { target: 'http://localhost:4010' },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router'], vendor: ['@tanstack/react-query', 'zod'] } },
    },
  },
});
