import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@infrastructure/anna', () => ({ isAnna: () => true, annaInvoke: mocks.invoke }));
import { readBackgroundVideo, MAX_VIDEO_BYTES } from '@infrastructure/background-video';
import { backgroundSlot } from '@ui/demo/fullscreen-cozy-home/background-slot';

describe('local background video', () => {
  beforeEach(() => vi.clearAllMocks());
  it('separates weather and time slots but ignores library weather', () => {
    expect(backgroundSlot('library', 'rain', 'day')).toBe(backgroundSlot('library', 'snow', 'day'));
    expect(backgroundSlot('study-room', 'rain', 'day')).not.toBe(backgroundSlot('study-room', 'rain', 'night'));
  });
  it('assembles bounded chunks and preserves the video type', async () => {
    mocks.invoke.mockResolvedValueOnce({ size: 3, bytes: [1, 2] }).mockResolvedValueOnce({ size: 3, bytes: [3] });
    const blob = await readBackgroundVideo('clip.WEBM', new AbortController().signal);
    expect(blob.type).toBe('video/webm');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(mocks.invoke.mock.calls[1][1].offset).toBe(2);
  });
  it.each([{ size: MAX_VIDEO_BYTES + 1, bytes: [1] }, { size: 1, bytes: [] }, { size: 1, bytes: [256] }, { size: 1, bytes: [1, 2] }])('rejects malformed or unbounded data %j', async chunk => {
    mocks.invoke.mockResolvedValue(chunk);
    await expect(readBackgroundVideo('clip.mp4', new AbortController().signal)).rejects.toThrow();
  });
  it('stops after a cancelled in-flight read without requesting more chunks', async () => {
    const controller = new AbortController();
    mocks.invoke.mockImplementation(async () => { controller.abort(); return { size: 2, bytes: [1] }; });
    await expect(readBackgroundVideo('clip.mp4', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
