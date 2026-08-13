/**
 * 对话分组：把信件拼成「一段段会话」。
 *
 * - 有 conversationId 的（多段对话）：按会话 id 归成一段。
 * - 老数据（无 conversationId）：寄出的信 + 它的回信归成一段；Flora 主动来信自成一段。
 * 返回带 letterIds（供删除）与 messages（供展示）。
 */
import type { Letter } from '../../ports';

export interface ConversationMessage {
  id: string;
  who: 'me' | 'flora';
  text: string;
  at: string;
}

export interface Conversation {
  id: string;
  conversationId?: string;
  title: string;
  updatedAt: string;
  messages: ConversationMessage[];
  letterIds: string[];
}

export const buildConversations = (letters: Letter[]): Conversation[] => {
  const sorted = [...letters].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // 1) 有 conversationId 的按会话分组
  const bySession = new Map<string, Letter[]>();
  const legacy: Letter[] = [];
  for (const letter of sorted) {
    if (letter.conversationId) {
      bySession.set(letter.conversationId, [...(bySession.get(letter.conversationId) ?? []), letter]);
    } else {
      legacy.push(letter);
    }
  }

  const conversations: Conversation[] = [];
  for (const [id, list] of bySession) {
    conversations.push({
      id,
      conversationId: id,
      title: list[0].letter.slice(0, 20),
      updatedAt: list[list.length - 1].createdAt,
      messages: list.map<ConversationMessage>((l) => ({
        id: l.id,
        who: l.direction === 'in' ? 'flora' : 'me',
        text: l.letter,
        at: l.createdAt,
      })),
      letterIds: list.map((l) => l.id),
    });
  }

  // 2) 老数据（无 conversationId）
  const legacyOut = legacy.filter((l) => l.direction !== 'in');
  const legacyReplies = legacy.filter((l) => l.direction === 'in' && l.type === 'reply');
  const legacyProactive = legacy.filter((l) => l.direction === 'in' && l.type !== 'reply');
  const used = new Set<string>();

  for (const out of legacyOut) {
    const messages: ConversationMessage[] = [
      { id: out.id, who: 'me', text: out.letter, at: out.createdAt },
    ];
    const ids = [out.id];
    if (out.reply) {
      messages.push({ id: `${out.id}-reply`, who: 'flora', text: out.reply, at: out.sentAt ?? out.createdAt });
    } else {
      const reply = legacyReplies.find((r) => !used.has(r.id) && r.createdAt >= out.createdAt);
      if (reply) {
        used.add(reply.id);
        messages.push({ id: reply.id, who: 'flora', text: reply.letter, at: reply.createdAt });
        ids.push(reply.id);
      }
    }
    conversations.push({
      id: out.id,
      title: out.letter.slice(0, 20),
      updatedAt: messages[messages.length - 1].at,
      messages,
      letterIds: ids,
    });
  }

  // 未被匹配到的回信 + Flora 主动来信
  for (const letter of [...legacyReplies.filter((r) => !used.has(r.id)), ...legacyProactive]) {
    conversations.push({
      id: letter.id,
      title: letter.letter.slice(0, 20),
      updatedAt: letter.createdAt,
      messages: [{ id: letter.id, who: 'flora', text: letter.letter, at: letter.createdAt }],
      letterIds: [letter.id],
    });
  }

  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};
