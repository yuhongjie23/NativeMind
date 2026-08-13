/**
 * ImportNoteUseCase 单测
 * 导入时带标签 → tags 落库（去空去重）；不带标签 → 空数组。
 */
import { describe, expect, it } from 'vitest';
import { ImportNoteUseCase } from '@application/use-cases/note/import-note';
import type { EventBus } from '@application/events/event-bus';
import type { FileImportPort, Note, NoteRepository } from '@application/ports';

describe('ImportNoteUseCase', () => {
  const makeDeps = (saved: Note[]) => {
    const noteRepo: NoteRepository = {
      findByContentHash: async () => null,
      findByTags: async () => [],
      findByIds: async () => [],
      findById: async () => null,
      save: async (note) => void saved.push(note),
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
});
