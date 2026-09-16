import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const releaseSnapshot = createRequire(import.meta.url)('../../scripts/release-snapshot.cjs');

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.SUB2API_DEV_TARGET || 'http://127.0.0.1:8000';
  const proxy = { target, changeOrigin: true, ws: true };
  const releaseAssets = mode === 'release' || !existsSync(path.resolve(__dirname, 'public'));
  return {
  define: {
    'import.meta.env.VITE_DESKTOP_WALLPAPERS': true,
    'import.meta.env.VITE_OFFICIAL_CONSOLE_URL': JSON.stringify(env.VITE_OFFICIAL_CONSOLE_URL || (command === 'serve' ? target : '')),
  },
  publicDir: releaseAssets ? 'public-release' : 'public',
  plugins: [vue(), releaseSnapshot.buildSnapshotPlugin(path.resolve(__dirname, '../..'), releaseAssets ? 'desktop-release-assets' : 'existing-macos-assets')],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sub2-mac/core': path.resolve(__dirname, '../mac-ui-core/src/index.ts')
    }
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '^/setup/(status|test-db|test-redis|install)$': { ...proxy },
      '/api': { ...proxy },
      '/v1': { ...proxy },
      '/health': { ...proxy }
    }
  }
  };
});
