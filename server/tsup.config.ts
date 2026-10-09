import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', 'create-admin': 'src/cli/create-admin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@habitat/shared'],
});
