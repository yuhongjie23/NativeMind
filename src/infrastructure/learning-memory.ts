import type { LearningRepository, LearningReminder, LearningKnowledge } from '@application/ports';

/** Browser demo only; deliberately does not open the user's desktop database. */
export class InMemoryLearningRepository implements LearningRepository {
  private reminders = new Map<string, LearningReminder>();
  private knowledge = new Map<string, LearningKnowledge>();
  private save<T extends { id: string; revision: number }>(map: Map<string, T>, value: T, expected: number | null): boolean {
    if ((map.get(value.id)?.revision ?? null) !== expected) return false;
    map.set(value.id, structuredClone(value)); return true;
  }
  async listReminders() { return structuredClone([...this.reminders.values()]); }
  async findReminder(id: string) { return structuredClone(this.reminders.get(id) ?? null); }
  async saveReminder(value: LearningReminder, expected: number | null) { return this.save(this.reminders, value, expected); }
  async listKnowledge() { return structuredClone([...this.knowledge.values()]); }
  async findKnowledge(id: string) { return structuredClone(this.knowledge.get(id) ?? null); }
  async saveKnowledge(value: LearningKnowledge, expected: number | null) { return this.save(this.knowledge, value, expected); }
}
