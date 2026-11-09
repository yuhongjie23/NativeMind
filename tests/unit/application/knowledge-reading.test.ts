import { expect, it } from 'vitest';
import { KnowledgeReadingUseCase } from '@application/use-cases/knowledge-reading';
import type { SettingsKeyValuePort } from '@application/ports';

function setup() {
  const data = new Map<string, string>();
  const settings: SettingsKeyValuePort = { get: async key => data.get(key) ?? null, set: async (key, value) => { await Promise.resolve(); data.set(key, value); } };
  return { data, settings, useCase: new KnowledgeReadingUseCase(settings) };
}
it('retains the question and latest position under concurrent updates and after reload', async () => {
  const { settings, useCase } = setup();
  await Promise.all([
    useCase.save('note-a', { position: { offset: 20, anchor: 'first point', exact: true } }),
    useCase.save('note-a', { question: 'Why does sorting matter?' }),
    useCase.save('note-a', { position: { offset: 100, anchor: 'next point', page: 28, exact: true } }),
  ]);
  expect(await new KnowledgeReadingUseCase(settings).load('note-a')).toMatchObject({
    question: 'Why does sorting matter?', position: { offset: 100, page: 28, anchor: 'next point', exact: true },
  });
  expect(await useCase.load('note-b')).toBeUndefined();
});
it('clears only the question and preserves position', async () => {
  const { useCase } = setup();
  await useCase.save('a', { question: 'question', position: { offset: 0, anchor: 'start', exact: true } });
  await useCase.save('a', { question: '' });
  expect(await useCase.load('a')).toMatchObject({ question: '', position: { offset: 0 } });
});
it('ignores corrupt stored records and rejects invalid positions', async () => {
  const { data, useCase } = setup();
  data.set('reading.progress.a', '{bad json');
  expect(await useCase.load('a')).toBeUndefined();
  await expect(useCase.save('a', { position: { offset: -2, anchor: 'test', exact: true } })).rejects.toThrow();
});
it('a failed write does not prevent a later retry', async () => {
  const { settings } = setup();
  let fails = true;
  const useCase = new KnowledgeReadingUseCase({ ...settings, set: async (key, value) => {
    if (fails) throw new Error('disk unavailable');
    await settings.set(key, value);
  } });
  await expect(useCase.save('a', { question: 'first' })).rejects.toThrow();
  fails = false;
  await useCase.save('a', { question: 'retry' });
  expect((await useCase.load('a'))?.question).toBe('retry');
});
