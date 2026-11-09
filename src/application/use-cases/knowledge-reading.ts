import type { ReadingPosition, ReadingProgress, SettingsKeyValuePort } from '../ports';

/** Serialize patches so a scroll update cannot erase the user's question. */
export class KnowledgeReadingUseCase {
  private writes = new Map<string, Promise<void>>();
  constructor(private readonly settings: SettingsKeyValuePort) {}
  private key(id: string): string { return `reading.progress.${encodeURIComponent(id)}`; }
  async load(id: string): Promise<ReadingProgress | undefined> {
    await this.writes.get(id);
    return this.read(id);
  }
  private async read(id: string): Promise<ReadingProgress | undefined> {
    const raw = await this.settings.get(this.key(id));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as ReadingProgress;
      if (typeof value.question !== 'string' || typeof value.updatedAt !== 'string') return undefined;
      const p = value.position;
      if (p && (!Number.isInteger(p.offset) || p.offset < 0 || typeof p.anchor !== 'string' || !p.anchor || p.anchor.length > 160 || typeof p.exact !== 'boolean' || (p.page !== undefined && (!Number.isInteger(p.page) || p.page < 1)))) return undefined;
      return value;
    } catch { return undefined; }
  }
  save(id: string, patch: { position?: ReadingPosition; question?: string }): Promise<void> {
    if (!id) return Promise.reject(new Error('Missing document ID'));
    const p = patch.position;
    if (p && (!Number.isInteger(p.offset) || p.offset < 0 || !p.anchor || p.anchor.length > 160 || typeof p.exact !== 'boolean' || (p.page !== undefined && (!Number.isInteger(p.page) || p.page < 1)))) return Promise.reject(new Error('Invalid reading position'));
    const write = (this.writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const previous = await this.read(id);
      await this.settings.set(this.key(id), JSON.stringify({
        position: patch.position ?? previous?.position,
        question: (patch.question ?? previous?.question ?? '').slice(0, 500),
        updatedAt: new Date().toISOString(),
      } satisfies ReadingProgress));
    });
    this.writes.set(id, write);
    void write.finally(() => { if (this.writes.get(id) === write) this.writes.delete(id); }).catch(() => {});
    return write;
  }
}
