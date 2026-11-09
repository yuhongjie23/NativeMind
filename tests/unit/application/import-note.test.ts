/**
 * ImportNoteUseCase 单测
 * 导入时带标签 → tags 落库（去空去重）；不带标签 → 空数组。
 */
import { describe, expect, it, vi } from 'vitest';
import { ImportNoteUseCase } from '@application/use-cases/note/import-note';
import type { EventBus } from '@application/events/event-bus';
import type { FileImportPort, Note, NoteRepository, NoteImportRepository } from '@application/ports';

describe('ImportNoteUseCase', () => {
  const makeDeps = (saved: Note[]) => {
    const noteRepo: NoteRepository & NoteImportRepository = {
      findByContentHash: async () => null,
      findByTags: async () => [],
      findByIds: async () => [],
      findById: async () => null,
      save: async (note) => void saved.push(note),
      commitImport: async (note) => { saved.push(note); return note; },
      delete: async () => undefined,
    };
    const fileImport: FileImportPort = {
      parse: async (source) =>
        source.kind === 'path'
          ? { title: '文件', content: '正文', sourceType: 'markdown' }
          : { title: source.title ?? '粘贴', content: source.content, sourceType: 'text' },
      hash: async (content) => `hash:${content}`,
    };
    const eventBus: EventBus = {
      subscribe: () => () => undefined,
      publish: async () => undefined,
      clear: async () => undefined,
    };
    return { noteRepo, fileImport, eventBus };
  };

  it('导入带标签时 tags 落库（去空去重）', async () => {
    const saved: Note[] = [];
    const { noteRepo, fileImport, eventBus } = makeDeps(saved);
    const useCase = new ImportNoteUseCase(noteRepo, fileImport, eventBus);

    await useCase.execute({
      kind: 'text',
      content: '今天学了微积分',
      title: '微积分笔记',
      tags: ['数学', ' 数学 ', '', '高等数学'],
    });

    expect(saved[0].tags).toEqual(['数学', '高等数学']);
  });

  it('不带标签时 tags 为空数组', async () => {
    const saved: Note[] = [];
    const { noteRepo, fileImport, eventBus } = makeDeps(saved);
    const useCase = new ImportNoteUseCase(noteRepo, fileImport, eventBus);

    await useCase.execute({ kind: 'text', content: '无标签正文', title: '普通笔记' });

    expect(saved[0].tags).toEqual([]);
  });

  it.each(['text', 'markdown', 'pdf'] as const)('rejects empty parsed %s before hashing, deduplication, saving or indexing', async (sourceType) => {
    const saved: Note[] = [];
    const { noteRepo, fileImport, eventBus } = makeDeps(saved);
    fileImport.parse = async () => ({ title: 'Metadata title', content: ' \n\t\u200B\u200D\uFEFF', sourceType });
    fileImport.hash = vi.fn();
    noteRepo.findByContentHash = vi.fn();
    eventBus.publish = vi.fn();
    const phases: string[] = [];
    await expect(new ImportNoteUseCase(noteRepo, fileImport, eventBus).execute(
      { kind: 'path', path: 'empty.document' }, { onPhase: phase => phases.push(phase) },
    )).rejects.toThrow(sourceType === 'pdf' ? '本机进行文字识别' : '导入内容为空');
    expect(phases).toEqual(['parsing']);
    expect(fileImport.hash).not.toHaveBeenCalled();
    expect(noteRepo.findByContentHash).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it.each(['parse', 'hash', 'duplicate'] as const)('cancels during %s without saving or scheduling indexing', async (stage) => {
    const saved: Note[] = [];
    const { noteRepo, fileImport, eventBus } = makeDeps(saved);
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { finish = resolve; });
    if (stage === 'parse') fileImport.parse = async () => { started(); await hold; return { title: 'late', content: 'late', sourceType: 'text' }; };
    if (stage === 'hash') fileImport.hash = async () => { started(); await hold; return 'hash'; };
    if (stage === 'duplicate') noteRepo.findByContentHash = async () => { started(); await hold; return null; };
    eventBus.publish = vi.fn();
    const controller = new AbortController();
    const pending = new ImportNoteUseCase(noteRepo, fileImport, eventBus).execute({ kind: 'text', content: 'draft' }, { signal: controller.signal });
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await ready;
    controller.abort();
    await cancelled;
    finish();
    await Promise.resolve();
    expect(saved).toEqual([]);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('finishes saving and publishes indexing exactly once after the commit boundary', async () => {
    const saved: Note[] = [];
    const { noteRepo, fileImport, eventBus } = makeDeps(saved);
    const controller = new AbortController();
    const phases: string[] = [];
    eventBus.publish = vi.fn();
    await new ImportNoteUseCase(noteRepo, fileImport, eventBus).execute({ kind: 'text', content: 'draft' }, {
      signal: controller.signal,
      onPhase: phase => { phases.push(phase); if (phase === 'saving') controller.abort(); },
    });
    expect(phases).toEqual(['parsing', 'checking', 'saving']);
    expect(saved).toHaveLength(1);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('does not even parse an already cancelled import', async () => {
    const { noteRepo, fileImport, eventBus } = makeDeps([]);
    fileImport.parse = vi.fn();
    const controller = new AbortController(); controller.abort();
    await expect(new ImportNoteUseCase(noteRepo, fileImport, eventBus).execute({ kind: 'text', content: 'draft' }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fileImport.parse).not.toHaveBeenCalled();
  });
});
