import { expect, it } from 'vitest';
import type { FocusRepository, LearningKnowledge, LearningRepository, TodoRepository, Todo } from '@application/ports';
import { learningLetter } from '@application/use-cases/flora/learning-letter-context';

const repos = (knowledge: LearningKnowledge[] = []) => ({
  todo: { findByDateRange: async () => [] } as unknown as TodoRepository,
  focus: { findByDateRange: async () => [] } as unknown as FocusRepository,
  learning: { listKnowledge: async () => knowledge } as unknown as LearningRepository,
});
const topic: LearningKnowledge = {
  id: 'k', title: 'Binary search', createdAt: '2026-11-08T10:00:00+08:00', updatedAt: '2026-11-08T10:00:00+08:00', revision: 1,
  observations: [{ at: '2026-11-08T10:00:00+08:00', rating: 'difficult', difficulty: 'Boundary conditions', result: '' }],
};
it('does not invent effort when no activity is recorded', async () => {
  expect(await learningLetter(repos(), '2026-11-09', 'en')).toBeUndefined();
});
it('uses a recent explicit difficulty, not an inferred emotion', async () => {
  const letter = await learningLetter(repos([topic]), '2026-11-09', 'en');
  expect(letter).toContain('Binary search');
  expect(letter).toContain('Boundary conditions');
  expect(letter).not.toMatch(/mastered|hard work|anxious/i);
});
it('does not reuse an older difficulty after a newer confident self-assessment', async () => {
  const updated = { ...topic, observations: [...topic.observations, { at: '2026-11-09T10:00:00+08:00', rating: 'confident' as const, difficulty: '', result: 'Can explain it' }] };
  expect(await learningLetter(repos([updated]), '2026-11-09', 'en')).toBeUndefined();
});
it('does not interpret stale or future observations as recent progress', async () => {
  for (const at of ['2026-10-01T10:00:00+08:00', '2026-12-01T10:00:00+08:00']) {
    expect(await learningLetter(repos([{ ...topic, observations: [{ ...topic.observations[0], at }] }]), '2026-11-09', 'en')).toBeUndefined();
  }
});

it('counts only valid recent completion timestamps and names a recorded task', async () => {
  const source = repos();
  source.todo.findCompletedByDateRange = async () => [
    { status: 'completed', title: 'Boundary practice', completedAt: '2026-11-08T10:00:00+08:00' },
    { status: 'completed', title: 'Old', completedAt: '2026-01-01T10:00:00+08:00' },
    { status: 'completed', title: 'Future', completedAt: '2026-12-01T10:00:00+08:00' },
    { status: 'completed', title: 'Unknown date' },
  ] as Todo[];
  const letter = await learningLetter(source, '2026-11-09', 'en');
  expect(letter).toContain('1 completed task and');
  expect(letter).toContain('Boundary practice');
  expect(letter).toContain('Based on:');
  expect(letter).not.toContain('Unknown date');
});
it('uses the latest assessment per topic rather than suppressing all difficulties after another topic improves', async () => {
  const other: LearningKnowledge = { ...topic, id: 'other', title: 'Other concept', observations: [{ ...topic.observations[0], at: '2026-11-09T09:00:00+08:00', rating: 'confident' }] };
  const letter = await learningLetter(repos([topic, other]), '2026-11-09', 'en');
  expect(letter).toContain('Boundary conditions');
  expect(letter).toContain('2026-11-08');
  expect(letter).not.toContain('Other concept');
});
