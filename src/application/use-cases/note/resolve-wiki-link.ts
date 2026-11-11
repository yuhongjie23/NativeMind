import type { Note, NoteRepository } from '../../ports';

export type WikiLinkResolution = { status: 'found'; note: Note } | { status: 'missing' | 'ambiguous' };

export class ResolveWikiLinkUseCase {
  constructor(private readonly notes: NoteRepository) {}
  async execute(title: string): Promise<WikiLinkResolution> {
    const matches = await this.notes.findByTitle(title.trim());
    if (matches.length > 1) return { status: 'ambiguous' };
    return matches[0] ? { status: 'found', note: matches[0] } : { status: 'missing' };
  }
}
