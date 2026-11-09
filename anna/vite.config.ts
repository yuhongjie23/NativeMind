import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import shared from '../vite.config';
import { checkAnnaBundle } from '../scripts/lib/check-anna-bundle.mjs';

export default mergeConfig(shared, defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: './',
  plugins: [{
    name: 'nativemind-anna-upload-limits',
    async writeBundle() {
      const result = await checkAnnaBundle(fileURLToPath(new URL('bundle', import.meta.url)));
      console.log(`Anna upload limits: ${result.fileCount} files, ${(result.totalBytes / 1_000_000).toFixed(2)} MB / 50 MB`);
    },
  }, {
    name: 'nativemind-anna-entry',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('/src/main.tsx', '/src/anna-main.ts'),
    },
    // Hand-written public asset URLs need to be relative inside Anna's versioned bundle.
    transform(code, id) {
      if (!id.includes('/src/') || !/\.[jt]sx?$/.test(id)) return;
      return code.replace(/(['"`])\/(audio|companions|icons|images|poems)\//g, '$1./$2/');
    },
  }],
  build: {
    outDir: fileURLToPath(new URL('bundle', import.meta.url)),
    emptyOutDir: true,
    // The local Anna server does not decode percent-encoded Chinese asset names.
    rollupOptions: { output: { assetFileNames: 'assets/[hash][extname]' } },
  },
}));
