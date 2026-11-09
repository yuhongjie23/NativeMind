import { fileURLToPath } from 'node:url';
import { readFile, unlink } from 'node:fs/promises';
import { defineConfig, mergeConfig } from 'vite';
import shared, { mediaOptimizer } from '../vite.config';
import { optimizeAppMedia } from '../scripts/build/optimize-media';
import { checkAnnaBundle } from '../scripts/lib/check-anna-bundle.mjs';

export default mergeConfig({ ...shared, plugins: shared.plugins?.filter(plugin => plugin !== mediaOptimizer) }, defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: './',
  plugins: [optimizeAppMedia(fileURLToPath(new URL('..', import.meta.url)), { staticVideo: true }), {
    name: 'nativemind-anna-upload-limits',
    async writeBundle() {
      // The short cue is embedded below; the version upload API rejects audio/wav.
      await unlink(fileURLToPath(new URL('bundle/audio/cue/complete.wav', import.meta.url))).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
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
    async transform(code, id) {
      if (!id.includes('/src/') || !/\.[jt]sx?$/.test(id)) return;
      if (id.replace(/\\/g, '/').endsWith('/src/infrastructure/audio/audio-library.ts')) {
        const bytes = await readFile(fileURLToPath(new URL('../public/audio/cue/complete.wav', import.meta.url)));
        const embedded = `URL.createObjectURL(new Blob([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0))], { type: 'audio/wav' }))`;
        code = code.replace("'/audio/cue/complete.wav'", embedded);
      }
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
