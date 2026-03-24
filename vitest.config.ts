import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts'],
    },
  },
  resolve: {
    alias: {
      uuid: fileURLToPath(new URL('./src/__mocks__/uuid.ts', import.meta.url)),
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
