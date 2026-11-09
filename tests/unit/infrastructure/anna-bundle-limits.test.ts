import { describe, expect, it } from 'vitest';
import { assessBundleFiles, bundleLimits } from '../../../scripts/lib/check-anna-bundle.mjs';

const entry = { path: 'index.html', bytes: 100 };
describe('Anna upload resource limits', () => {
  it('accepts safe relative resources within all limits', () => {
    expect(assessBundleFiles([entry, { path: 'assets/abc.webp', bytes: bundleLimits.fileBytes }])).toMatchObject({ valid: true, fileCount: 2 });
  });
  it('rejects oversized individual files and totals independently', () => {
    expect(assessBundleFiles([entry, { path: 'video.mp4', bytes: 10_000_001 }]).errors).toContain('单文件超过 10 MB：video.mp4');
    const result = assessBundleFiles([entry, ...Array.from({ length: 5 }, (_, i) => ({ path: `${i}.webp`, bytes: 10_000_000 }))]);
    expect(result.errors).toEqual(['界面资源总大小超过 50 MB']);
  });
  it('rejects unsafe paths, missing entry, invalid size and unsupported types', () => {
    for (const path of ['../a.png', 'a/../b.png', 'a\\b.png', '/a.png', 'a//b.png', '背景.png', 'a.exe']) {
      expect(assessBundleFiles([entry, { path, bytes: 10 }]).valid).toBe(false);
    }
    expect(assessBundleFiles([]).valid).toBe(false);
    expect(assessBundleFiles([entry, { path: 'x.png', bytes: NaN }]).valid).toBe(false);
    expect(assessBundleFiles([entry, { path: 'INDEX.html', bytes: 20 }]).valid).toBe(false);
  });
  it('rejects more than 2000 files without requiring large fixtures', () => {
    expect(assessBundleFiles([entry, ...Array.from({ length: 2000 }, (_, i) => ({ path: `${i}.txt`, bytes: 1 }))]).errors).toContain('资源数量超过 2000');
  });
});
