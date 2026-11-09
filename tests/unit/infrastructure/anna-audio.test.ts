import { beforeEach, describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import { annaInvoke } from '@infrastructure/anna/bridge';
import { readAnnaAudio } from '@infrastructure/anna/audio';
import { stageAnnaAudio, stageAnnaDocument } from '@infrastructure/anna/file-import';

vi.mock('@infrastructure/anna/bridge', () => ({ annaInvoke: vi.fn() }));
const invoke = vi.mocked(annaInvoke);

describe('Anna audio transfer', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('assembles exact bytes across frames', async () => {
    invoke.mockResolvedValueOnce({ size: 5, bytes: [0, 1, 255] }).mockResolvedValueOnce({ size: 5, bytes: [128, 64] });
    expect(Array.from(new Uint8Array(await readAnnaAudio('music/song.wav')))).toEqual([0, 1, 255, 128, 64]);
    expect(invoke).toHaveBeenLastCalledWith('audio_read_chunk', { path: 'music/song.wav', offset: 3 });
  });

  it.each([
    { size: 1, bytes: [] }, { size: 1, bytes: [256] }, { size: 1, bytes: [1, 2] },
    { size: 33 * 1024 * 1024, bytes: [1] },
  ])('rejects malformed or unbounded audio data: %j', async (chunk) => {
    invoke.mockResolvedValue(chunk);
    await expect(readAnnaAudio('music/song.wav')).rejects.toThrow();
  });

  it('rejects a file changing size while reading', async () => {
    invoke.mockResolvedValueOnce({ size: 2, bytes: [0] }).mockResolvedValueOnce({ size: 3, bytes: [1] });
    await expect(readAnnaAudio('song.wav')).rejects.toThrow('发生变化');
  });

  it('commits after all chunks and preserves the readable filename', async () => {
    invoke.mockResolvedValue('music/stored.wav');
    const file = new File([new Uint8Array(65537)], '学习音乐.wav');
    expect(await stageAnnaAudio(file as unknown as globalThis.File)).toBe('music/stored.wav');
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls[0][1]).toMatchObject({ kind: 'audio', offset: 0, complete: false, name: expect.stringContaining('_学习音乐.wav') });
    expect(invoke.mock.calls[1][1]).toMatchObject({ kind: 'audio', offset: 65536, bytes: [0], complete: false });
    expect(invoke.mock.calls[2]).toEqual(['file_stage_commit', { kind: 'audio', name: invoke.mock.calls[0][1]?.name, size: 65537 }]);
  });

  it('rejects empty audio and wrong formats before sending bytes', async () => {
    await expect(stageAnnaAudio(new File([], 'empty.wav') as unknown as globalThis.File)).rejects.toThrow('为空');
    await expect(stageAnnaAudio(new File(['x'], 'script.exe') as unknown as globalThis.File)).rejects.toThrow('格式');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps document imports in their separate directory', async () => {
    invoke.mockResolvedValue('imports/note.txt');
    await stageAnnaDocument(new File(['note'], '笔记.txt') as unknown as globalThis.File);
    expect(invoke.mock.calls[0][1]).toMatchObject({ kind: 'document', complete: false });
  });

  it('waits for an in-flight write before cancellation cleanup and never commits', async () => {
    const controller = new AbortController();
    let finish!: (value: string) => void;
    invoke.mockImplementation(async (command) => command === 'file_stage'
      ? new Promise<string>((resolve) => { finish = resolve; }) : undefined);
    const transfer = stageAnnaAudio(new File([new Uint8Array(65537)], 'song.wav') as unknown as globalThis.File, { signal: controller.signal });
    await vi.waitFor(() => expect(finish).toBeDefined());
    controller.abort();
    expect(invoke).toHaveBeenCalledTimes(1);
    finish('unused');
    await expect(transfer).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['file_stage', 'file_stage_abort']);
    expect(invoke.mock.calls[1][1]).toMatchObject({ name: invoke.mock.calls[0][1]?.name, kind: 'audio' });
  });

  it('reports acknowledged bytes and can cancel after the final chunk before commit', async () => {
    invoke.mockResolvedValue('unused');
    const controller = new AbortController();
    const progress: number[] = [];
    await expect(stageAnnaDocument(new File(['abc'], 'note.txt') as unknown as globalThis.File, {
      signal: controller.signal,
      onProgress: (value) => { progress.push(value.bytes); if (value.bytes === 3) controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toEqual([0, 3]);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['file_stage', 'file_stage_abort']);
  });

  it('honors commit completion when cancellation arrives after commit begins', async () => {
    const controller = new AbortController();
    invoke.mockImplementation(async (command) => {
      if (command === 'file_stage_commit') controller.abort();
      return 'saved.wav';
    });
    await expect(stageAnnaAudio(new File(['abc'], 'song.wav') as unknown as globalThis.File, {
      signal: controller.signal,
    })).resolves.toBe('saved.wav');
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['file_stage', 'file_stage_commit']);
  });

  it('cleans up failed transfers, but surfaces cleanup failure instead of claiming cancellation', async () => {
    invoke.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined);
    await expect(stageAnnaAudio(new File(['abc'], 'song.wav') as unknown as globalThis.File)).rejects.toThrow('disk full');
    expect(invoke.mock.calls[1][0]).toBe('file_stage_abort');
    invoke.mockReset();
    invoke.mockRejectedValue(new Error('bridge disconnected'));
    await expect(stageAnnaAudio(new File(['abc'], 'song.wav') as unknown as globalThis.File)).rejects.toThrow('清理失败');
  });

  it('does not send bytes for an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(stageAnnaAudio(new File(['abc'], 'song.wav') as unknown as globalThis.File, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
