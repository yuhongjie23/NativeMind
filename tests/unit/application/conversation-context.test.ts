import { expect, it } from 'vitest';
import type { Letter, LetterRepository } from '@application/ports';
import { loadConversationContext } from '@application/use-cases/flora/conversation-context';

const letter = (id: string, session: string | undefined, content = id): Letter => ({
  id, conversationId: session, letter: content, language: 'en', direction: 'out', type: 'warm',
  sendAfter: '2026-11-01T00:00:00Z', status: 'sent', createdAt: `2026-11-01T00:${id.padStart(2, '0')}:00Z`,
});
const repo = (letters: Letter[]) => ({ list: async () => letters }) as unknown as LetterRepository;
it('bounds history and keeps recent turns ahead of older excerpts', async () => {
  const result = await loadConversationContext(repo(Array.from({ length: 30 }, (_, i) => letter(String(i), 'a', 'x'.repeat(5000)))), 'a');
  expect(result?.recent).toHaveLength(8);
  expect(result?.earlierExcerpts).toHaveLength(8);
  expect(result?.recent.every(item => item.content.length <= 1000)).toBe(true);
  expect(result?.earlierExcerpts.every(item => item.content.length <= 160)).toBe(true);
});
it('pending retries exclude their own message and future turns', async () => {
  const before = letter('2', 'a');
  const context = await loadConversationContext(repo([letter('1', 'a'), before, letter('3', 'a'), letter('0', 'b')]), 'a', before);
  expect(context?.recent.map(item => item.content)).toEqual(['1']);
});
it('legacy history includes only the explicitly selected letter and its inline reply', async () => {
  const context = await loadConversationContext(repo([{ ...letter('1', undefined), reply: 'Its own reply' }, letter('2', undefined)]), '1');
  expect(context?.recent.map(item => item.content)).toEqual(['1', 'Its own reply']);
});
