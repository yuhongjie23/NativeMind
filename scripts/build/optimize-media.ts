import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import type { Plugin } from 'vite';

/** Build-only derivatives shared by desktop and Anna; original assets remain untouched. */
export function optimizeAppMedia(root: string, options: { staticVideo?: boolean } = {}): Plugin {
  const cache = join(root, 'node_modules', '.cache', 'nativemind-anna-media');
  return {
    name: 'nativemind-media', enforce: 'pre', apply: 'build',
    async load(id) {
      if (!/\/src\/ui\/background\/[^?]+\.(png|mp4)$/.test(id.replace(/\\/g, '/'))) return;
      const video = id.endsWith('.mp4');
      const original = await readFile(id);
      const poster = video && options.staticVideo;
      const key = createHash('sha256').update(poster ? 'anna-media-v2-video-poster-first-frame' : 'anna-media-v1-lossless-webp-h264-crf23-no-audio').update(original).digest('hex');
      const extension = video && !poster ? '.mp4' : '.webp';
      const path = join(cache, key + extension);
      await mkdir(cache, { recursive: true });
      let source: Buffer;
      try { source = await readFile(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const temporary = join(cache, `${key}-${process.pid}.tmp${extension}`);
        try {
          if (poster) {
            await promisify(execFile)(ffmpeg.path, ['-nostdin', '-y', '-i', id, '-map', '0:v:0', '-frames:v', '1',
              '-c:v', 'libwebp', '-lossless', '1', temporary],
            { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
          } else if (video) {
            await promisify(execFile)(ffmpeg.path, ['-nostdin', '-y', '-i', id, '-map', '0:v:0', '-an',
              '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temporary],
            { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
          } else {
            await sharp(original).webp({ lossless: true }).toFile(temporary);
          }
          await rename(temporary, path);
        } finally { await unlink(temporary).catch(() => undefined); }
        source = await readFile(path);
      }
      const reference = this.emitFile({ type: 'asset', name: basename(id).replace(/\.[^.]+$/, extension), source });
      // Rollup calculates hashes and all referencing URLs after conversion.
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}
