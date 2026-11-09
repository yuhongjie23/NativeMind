import { useEffect } from 'react';
import type { Note } from '@application/ports';
import { useT } from '../../../i18n';
import { aiMode } from '../../../stores/runtime';
import { useNoteStore } from '../../../stores/note-store';

const labels: Record<Note['indexStatus'], string> = {
  pending: '等待后台索引', parsing: '正在解析', chunking: '正在切分正文',
  indexing: '正在生成向量', indexed: '索引已完成', failed: '索引失败', stale: '索引需要更新',
};

export function NoteIndexStatus({ note }: { note: Note }) {
  const t = useT();
  const busy = useNoteStore(state => !!state.retryingIndex[note.id]);
  const retry = useNoteStore(state => state.retryIndex);
  const refresh = useNoteStore(state => state.refreshIndex);
  useEffect(() => {
    if (aiMode !== 'model') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (document.visibilityState === 'visible') await refresh(note.id);
      if (!stopped && note.indexStatus !== 'indexed') timer = setTimeout(() => { void poll(); }, 3000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [note.id, note.indexStatus, refresh]);

  if (aiMode !== 'model') return <p className="cozy-settings__hint">{t('网页演示使用关键词检索，不生成向量索引。')}</p>;
  const label = note.indexStatus === 'indexed' && note.indexError ? '索引降级为关键词检索'
    : note.indexStatus === 'pending' && note.indexError ? '索引暂时失败，等待自动重试'
    : labels[note.indexStatus];
  return <div className="cozy-note-index">
    <p role="status">{t(label)}</p>
    {note.indexError && <p className="cozy-settings__hint">{note.indexError}</p>}
    <button type="button" className="cozy-btn-secondary" disabled={busy} onClick={() => void retry(note.id)}>
      {t(busy ? '正在提交…' : note.indexStatus === 'indexed' ? '重建索引' : '重试索引')}
    </button>
    {' '}<button type="button" className="cozy-btn-ghost" onClick={() => void refresh(note.id)}>{t('刷新索引状态')}</button>
    <p className="cozy-settings__hint">{t('使用已保存的正文重建，不重新读取原文件。索引失败时，笔记正文仍然保留。')}</p>
  </div>;
}
