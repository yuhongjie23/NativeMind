import { it, expect } from 'vitest';
import sharp from 'sharp';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PluginContext, EmittedFile } from 'rollup';
import { optimizeAppMedia } from '../../../scripts/build/optimize-media';

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
