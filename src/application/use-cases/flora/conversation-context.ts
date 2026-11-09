import type { FloraConversationContext, LetterRepository } from '../../ports';

/** Never infer links between legacy letters by timestamp: that can leak another conversation. */
export async function loadConversationContext(
  repo: LetterRepository, sessionId?: string, before?: { id: string; createdAt: string }
): Promise<FloraConversationContext | undefined> {
  if (!sessionId) return undefined;
  const letters = (await repo.list(1000)).filter(letter =>
    (letter.conversationId === sessionId || (!letter.conversationId && letter.id === sessionId)) &&
    letter.id !== before?.id && (!before || letter.createdAt < before.createdAt)
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const messages: FloraConversationContext['recent'] = [];
  for (const letter of letters) {
    messages.push({ role: letter.direction === 'in' ? 'assistant' : 'user', content: letter.letter });
    if (letter.reply) messages.push({ role: 'assistant', content: letter.reply });
  }
  if (!messages.length) return undefined;
  return {
    recent: messages.slice(-8).map(message => ({ ...message, content: message.content.slice(0, 1000) })),
    earlierExcerpts: messages.slice(-16, -8).map(message => ({ ...message, content: message.content.slice(0, 160) })),
  };
}
