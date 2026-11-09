/**
 * 「对话」栏 —— 多段会话式聊天。
 *
 * 会话列表（每段一个入口，可删除）→ 点开进入对话窗口，可连续多段聊下去；
 * 退出后该段对话保存在本地 SQLite，随时可再进入继续。支持删除（本地一并删）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import type { Conversation } from '@application/use-cases/flora/conversation-utils';
import { useT } from '../../../i18n';
import { useConfirmationStore } from '../../../stores/confirmation-store';
import { describeError, useCases } from '../../../stores/runtime';
import { useSettingsStore } from '../../../stores/settings-store';

export function LetterPanel() {
  const t = useT();
  const language = useSettingsStore((state) => state.language);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); // null=列表；'new'=新对话
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [canCancel, setCanCancel] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const committing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRequest.current?.abort(); };
  }, []);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      await useCases.processLetters.execute();
      await useCases.generateIncomingLetter.execute(); // 每日一次，30% Flora 来信
      setConversations(await useCases.listConversations.execute());
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 新消息后滚到底部
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [conversations, activeId, streamingReply]);

  const active = activeId === 'new' ? null : conversations.find((c) => c.id === activeId) ?? null;

  const onSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    committing.current = false;
    setCanCancel(true);
    setStreamingReply('');
    setSending(true);
    setError('');
    try {
      // 续进当前会话（active 有 id 则续；新对话不传 → 内部新开会话）
      const sent = await useCases.writeLetter.execute(trimmed, language, active?.conversationId ?? active?.id ?? undefined, {
        signal: controller.signal,
        onToken: (delta, reset) => {
          if (activeRequest.current === controller && mounted.current && !controller.signal.aborted) {
            setStreamingReply(current => reset ? '' : current + delta);
          }
        },
        onCommit: () => {
          if (activeRequest.current === controller) {
            committing.current = true;
            if (mounted.current) setCanCancel(false);
          }
        },
      });
      if (!mounted.current || activeRequest.current !== controller) return;
      setDraft('');
      const latest = await useCases.listConversations.execute();
      if (!mounted.current || activeRequest.current !== controller) return;
      setConversations(latest);
      if (activeId === 'new') setActiveId(sent.conversationId ?? sent.id);
    } catch (caught) {
      if (mounted.current && activeRequest.current === controller && !controller.signal.aborted) setError(describeError(caught));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (mounted.current) { setSending(false); setCanCancel(false); setStreamingReply(''); }
      }
    }
  };

  const stopReply = () => {
    if (!canCancel || committing.current) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setSending(false);
    setCanCancel(false);
    setStreamingReply('');
  };

  const onDelete = async (conversation: Conversation) => {
    const ok = await useConfirmationStore.getState().requestSimple({
      title: t('删除这段对话'),
      message: t('删除后这段对话不会保留，确定吗？'),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (!ok) return;
    try {
      await useCases.deleteConversation.execute(conversation.id);
      if (activeId === conversation.id) setActiveId(null);
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const locale = language === 'en' ? 'en-US' : 'zh-CN';
  const formatTime = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  /* ---- 会话列表视图 ---- */
  if (activeId === null) {
    return (
      <div className="letter-panel">
        <p className="letter-panel__intro">
          {t('和 Flora 说说心里话吧。每段对话都会保存，随时可以回来继续。')}
        </p>
        <div className="letter-panel__actions">
          <button type="button" className="cozy-btn-primary" onClick={() => setActiveId('new')}>
            <MessageSquarePlus size={16} strokeWidth={1.75} aria-hidden="true" />
            {t('新对话')}
          </button>
        </div>
        {error ? <p className="cozy-today-error">{error}</p> : null}
        <h3 className="panel-section-title">{t('历史会话（{0}）', conversations.length)}</h3>
        {conversations.length === 0 ? (
          <p className="cozy-today-empty">{t('还没有对话，开一段新的吧。')}</p>
        ) : (
          <ul className="letter-conv-list">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="letter-conv-item">
                <button
                  type="button"
                  className="letter-conv-item__main"
                  onClick={() => setActiveId(conversation.id)}
                >
                  <strong className="letter-conv-item__title">{conversation.title || '…'}</strong>
                  <span className="letter-conv-item__meta">
                    {formatDate(conversation.updatedAt)} · {t('{0} 条消息', conversation.messages.length)}
                  </span>
                </button>
                <button
                  type="button"
                  className="letter-conv-item__del"
                  aria-label={t('删除这段对话')}
                  title={t('删除这段对话')}
                  onClick={() => void onDelete(conversation)}
                >
                  <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  /* ---- 对话窗口视图 ---- */
  const messages = active?.messages ?? [];

  return (
    <div className="letter-chat">
      <div className="letter-chat__head">
        <button type="button" className="cozy-btn-ghost" disabled={sending} onClick={() => setActiveId(null)}>
          ← {t('返回会话列表')}
        </button>
        {active ? (
          <button
            type="button"
            className="cozy-btn-ghost letter-chat__del"
            disabled={sending}
            onClick={() => void onDelete(active)}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            {t('删除')}
          </button>
        ) : null}
      </div>

      <div className="letter-chat__thread" ref={threadRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="cozy-today-empty">{t('新的一段对话，先说点什么吧。')}</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="letter-chat__row" data-who={message.who}>
              <div className="letter-chat__bubble">
                <p className="letter-chat__text">{message.text}</p>
                <time className="letter-chat__time">{formatTime(message.at)}</time>
              </div>
            </div>
          ))
        )}
        {sending && <div className="letter-chat__row" data-who="flora">
          <div className="letter-chat__bubble"><p className="letter-chat__text">
            {streamingReply || t('正在组织回复…')}
          </p></div>
        </div>}
      </div>

      <div className="letter-chat__compose">
        <label className="sr-only" htmlFor="letter-content">
          {t('想说的话')}
        </label>
        <textarea
          id="letter-content"
          className="letter-chat__input"
          placeholder={t('此刻想说什么…')}
          value={draft}
          disabled={sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
        />
        <button
          type="button"
          className="cozy-btn-primary letter-chat__send"
          disabled={!draft.trim() || sending}
          onClick={() => void onSend()}
        >
          {sending ? t('对话中…') : t('发送')}
        </button>
      </div>
      {canCancel && <button type="button" className="cozy-btn-secondary" onClick={stopReply}>{t('停止生成')}</button>}
      {error ? <p className="cozy-today-error">{error}</p> : null}
    </div>
  );
}
