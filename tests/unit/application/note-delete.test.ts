/**
 * DeleteNoteUseCase 单测
 * 删除正文 + 清理向量（向量库不可用时也要能删）。
 */
import { describe, expect, it } from 'vitest';
import { DeleteNoteUseCase } from '@application/use-cases/note/delete-note';
import type { NoteRepository, NoteVectorCleanupPort } from '@application/ports';

describe('DeleteNoteUseCase', () => {
  it('删除笔记并清理对应向量', async () => {
    const deleted: string[] = [];
    const cleaned: string[] = [];
    const noteRepo = { delete: async (id: string) => void deleted.push(id) } as unknown as NoteRepository;
    const vectorCleanup: NoteVectorCleanupPort = {
      deleteByNote: async (id: string) => void cleaned.push(id),
    };

    const useCase = new DeleteNoteUseCase(noteRepo, vectorCleanup);
    await useCase.execute('note-1');

    expect(deleted).toEqual(['note-1']);
    expect(cleaned).toEqual(['note-1']);
  });

  it('向量库不可用时删除仍成功（不抛错）', async () => {
    const deleted: string[] = [];
    const noteRepo = { delete: async (id: string) => void deleted.push(id) } as unknown as NoteRepository;
    const throwing: NoteVectorCleanupPort = {
      deleteByNote: async () => {
        throw new Error('向量库挂了');
      },
    };

    const useCase = new DeleteNoteUseCase(noteRepo, throwing);
    await expect(useCase.execute('note-1')).resolves.toBe(true);
    expect(deleted).toEqual(['note-1']);
  });

  it('删除笔记时同步清理它的知识链接（图谱不残留悬空边）', async () => {
    const deleted: string[] = [];
    const cleaned: string[] = [];
    const noteRepo = { delete: async (id: string) => void deleted.push(id) } as unknown as NoteRepository;
    const linkRepo = {
      deleteByEntity: async (entity: { type: string; id: string }) => void cleaned.push(entity.id),
    };

    const useCase = new DeleteNoteUseCase(noteRepo, undefined, undefined, undefined, linkRepo as never);
    await useCase.execute('note-1');

    expect(deleted).toEqual(['note-1']);
    expect(cleaned).toEqual(['note-1']);
  });

  it('知识链接清理失败不阻塞删除（C3 降级）', async () => {
    const deleted: string[] = [];
    const noteRepo = { delete: async (id: string) => void deleted.push(id) } as unknown as NoteRepository;
    const linkRepo = {
      deleteByEntity: async () => {
        throw new Error('链接表挂了');
      },
    };

    const useCase = new DeleteNoteUseCase(noteRepo, undefined, undefined, undefined, linkRepo as never);
    await expect(useCase.execute('note-1')).resolves.toBe(true);
    expect(deleted).toEqual(['note-1']);
  });
});
