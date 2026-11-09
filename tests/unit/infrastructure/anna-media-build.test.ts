import { it, expect } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PluginContext, EmittedFile } from 'rollup';
import { optimizeAppMedia } from '../../../scripts/build/optimize-media';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

it('desktop and Anna emit lossless derivatives with Rollup URLs and preserve source/other assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anna-media-test-'));
  try {
    const folder = join(root, 'src', 'ui', 'background'); await mkdir(folder, { recursive: true });
    const file = join(folder, '背景.png');
    await sharp({ create: { width: 20, height: 16, channels: 4, background: { r: 12, g: 98, b: 230, alpha: 0.5 } } }).png().toFile(file);
    const original = await readFile(file);
    const emitted: EmittedFile[] = [];
    const context = { emitFile: (asset: EmittedFile) => { emitted.push(asset); return 'test-id'; } } as unknown as PluginContext;
    const load = optimizeAppMedia(root).load;
    if (typeof load !== 'function') throw new Error('Expected build load hook');
    const result = await load.call(context, file);
    expect(result).toContain('import.meta.ROLLUP_FILE_URL_test-id');
    const output = emitted[0];
    if (output.type !== 'asset' || !output.source || typeof output.source === 'string') throw new Error('Expected binary asset');
    const decoded = await sharp(output.source).raw().toBuffer();
    expect(decoded).toEqual(await sharp(original).raw().toBuffer());
    expect(await readFile(file)).toEqual(original);
    expect(await load.call(context, join(root, 'src', 'ui', 'pets', 'pet.png'))).toBeUndefined();
    expect(await load.call(context, `${file}?raw`)).toBeUndefined();
    await load.call(context, file); // Cached build has identical content.
    expect(emitted[1]).toEqual(emitted[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('poster and embedded-video builds preserve the desktop video bytes and original source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anna-poster-test-'));
  try {
    const folder = join(root, 'src', 'ui', 'background'); await mkdir(folder, { recursive: true });
    const file = join(folder, 'day.mp4');
    await promisify(execFile)(ffmpeg.path, ['-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=32x24:d=0.1', '-pix_fmt', 'yuv420p', file], { windowsHide: true });
    const original = await readFile(file);
    let desktopBytes: Uint8Array | undefined;
    for (const staticVideo of [true, false]) {
      const emitted: EmittedFile[] = [];
      const context = { emitFile: (asset: EmittedFile) => { emitted.push(asset); return 'media'; } } as unknown as PluginContext;
      const load = optimizeAppMedia(root, { staticVideo }).load;
      if (typeof load !== 'function') throw new Error('Expected load hook');
      await load.call(context, file);
      const asset = emitted[0];
      if (asset.type !== 'asset' || !asset.source || typeof asset.source === 'string') throw new Error('Expected media bytes');
      expect(asset.name).toBe(staticVideo ? 'day.webp' : 'day.mp4');
      if (staticVideo) expect(await sharp(asset.source).metadata()).toMatchObject({ format: 'webp', width: 32, height: 24 });
      else {
        desktopBytes = asset.source;
        expect(Buffer.from(asset.source).subarray(4, 8).toString()).toBe('ftyp');
      }
    }
    const embeddedLoad = optimizeAppMedia(root, { embedVideo: true }).load;
    if (typeof embeddedLoad !== 'function') throw new Error('Expected load hook');
    const noAssets = { emitFile: () => { throw new Error('Embedded video must not emit a separate file'); } } as unknown as PluginContext;
    const moduleSource = await embeddedLoad.call(noAssets, file);
    if (typeof moduleSource !== 'string') throw new Error('Expected embedded module');
    const encoded = /atob\(("[^"]+")\)/.exec(moduleSource)?.[1];
    expect(encoded).toBeDefined();
    const blob = new Blob([Buffer.from(JSON.parse(encoded!) as string, 'base64')], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    try {
      const response = await fetch(url);
      expect(response.headers.get('content-type')).toBe('video/mp4');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(desktopBytes!));
    } finally { URL.revokeObjectURL(url); }
    expect(await readFile(file)).toEqual(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
