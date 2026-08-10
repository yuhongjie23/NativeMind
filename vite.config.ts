import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** 与 tsconfig.json 的 paths 保持一致，改一处要同时改另一处 */
const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
  '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
  '@ai': fileURLToPath(new URL('./src/ai', import.meta.url)),
  '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
  '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
  '@shared-types': fileURLToPath(new URL('./src/types', import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { alias },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/src-tauri/target/**',
        '**/node_modules/**',
        // 用户数据/媒体目录：Vite 没必要监听；正被播放器占用的音频文件会让
        // watcher 报 EBUSY 直接崩掉整个 dev server（如 download/imports/*.flac）
        '**/download/**',
        '**/musics/**',
        '**/ollama-models/**',
        '**/imports/**',
        '**/backups/**',
        '**/extensions/**',
        // 任何位置的音视频文件都不监听（可能被播放占用）
        (path) => /\.(mp3|flac|wav|ogg|m4a|mp4|webm|avi|mov|mkv|opus)$/i.test(path),
      ],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
