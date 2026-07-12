import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'chrome85' },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
