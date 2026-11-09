import type { LearningRepository, LearningReminder, LearningKnowledge } from '@application/ports';
import type { Database } from '../database';

export class SqliteLearningRepository implements LearningRepository {
  constructor(private readonly db: Database) {}
  private async list<T>(table: 'learning_reminders' | 'learning_knowledge'): Promise<T[]> {
    return (await this.db.select(`SELECT payload FROM ${table} ORDER BY id`)).map(row => JSON.parse(String(row.payload)) as T);
  }
  private async find<T>(table: 'learning_reminders' | 'learning_knowledge', id: string): Promise<T | null> {
    const row = await this.db.selectOne(`SELECT payload FROM ${table} WHERE id = ?`, [id]);
    return row ? JSON.parse(String(row.payload)) as T : null;
  }
  private async save(table: 'learning_reminders' | 'learning_knowledge', value: { id: string; revision: number }, expected: number | null): Promise<boolean> {
    const payload = JSON.stringify(value);
    return expected === null
      ? (await this.db.execute(`INSERT OR IGNORE INTO ${table} (id, revision, payload) VALUES (?, ?, ?)`, [value.id, value.revision, payload])) === 1
      : (await this.db.execute(`UPDATE ${table} SET revision = ?, payload = ? WHERE id = ? AND revision = ?`, [value.revision, payload, value.id, expected])) === 1;
  }
  listReminders() { return this.list<LearningReminder>('learning_reminders'); }
  findReminder(id: string) { return this.find<LearningReminder>('learning_reminders', id); }
  saveReminder(value: LearningReminder, expected: number | null) { return this.save('learning_reminders', value, expected); }
  listKnowledge() { return this.list<LearningKnowledge>('learning_knowledge'); }
  findKnowledge(id: string) { return this.find<LearningKnowledge>('learning_knowledge', id); }
  saveKnowledge(value: LearningKnowledge, expected: number | null) { return this.save('learning_knowledge', value, expected); }
}
