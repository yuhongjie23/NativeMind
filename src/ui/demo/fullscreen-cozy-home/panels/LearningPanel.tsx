import { useRef, useState } from 'react';
import type { LearningKnowledge, RecallRating, ReminderKind, ReminderRepeat } from '@application/ports';
import { useLearningStore } from '../../../stores/learning-store';
import { useReviewStore } from '../../../stores/review-store';
import { useNoteStore } from '../../../stores/note-store';
import { aiMode } from '../../../stores/runtime';
import './learning-panel.css';

const ratings: Record<RecallRating, string> = { new: '刚开始', difficult: '仍有困难', forgotten: '回忆不起来', familiar: '基本能回忆', confident: '能解释并应用' };
const localTime = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};
const formatTime = (date: string) => new Date(date).toLocaleString();

export function LearningPanel() {
  const reminderForm = useRef<HTMLFormElement>(null);
  const knowledgeForm = useRef<HTMLFormElement>(null);
  const state = useLearningStore();
  const review = useReviewStore();
  const notes = useNoteStore(s => s.notes);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ReminderKind>('study');
  const [repeat, setRepeat] = useState<ReminderRepeat>('once');
  const [due, setDue] = useState(() => localTime(new Date(Date.now() + 3600000)));
  const [knowledgeId, setKnowledgeId] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [selected, setSelected] = useState<LearningKnowledge>();
  const [topic, setTopic] = useState('');
  const [noteId, setNoteId] = useState('');
  const [rating, setRating] = useState<RecallRating>('new');
  const [difficulty, setDifficulty] = useState('');
  const [result, setResult] = useState('');
  const [showFinished, setShowFinished] = useState(false);
  const reminders = state.reminders.filter(item => showFinished || item.state === 'scheduled').sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const chooseKnowledge = (item: LearningKnowledge) => { setSelected(item); setTopic(item.title); setNoteId(item.noteId ?? ''); setRating(item.observations.at(-1)?.rating ?? 'new'); setDifficulty(''); setResult(''); knowledgeForm.current?.scrollIntoView({ block: 'start' }); };
  return <div className="learning-panel">
    {aiMode === 'template' && <p className="learning-caption">当前为浏览器演示，提醒与自评在刷新后清空；持久保存请使用桌面或 Anna 本地运行版。</p>}
    <section className="learning-section">
      <h3>安排学习与复习</h3>
      <p>提醒会留在这里等待处理；错过后不连续催促。专注时不显示到期提示，也不主动发起 AI 对话。</p>
      <form ref={reminderForm} onSubmit={event => { event.preventDefault(); void (async () => {
        if (await state.createReminder({ title, kind, dueAt: due, repeat, knowledgeId: knowledgeId || undefined, reviewId: kind === 'reflection' ? reviewId || undefined : undefined })) setTitle('');
      })(); }}>
        <label>提醒内容<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：复述二分查找的前提" /></label>
        <div className="learning-form-row">
          <label>类型<select value={kind} onChange={e => setKind(e.target.value as ReminderKind)}><option value="study">学习</option><option value="review">知识复习</option><option value="reflection">建议执行复盘</option></select></label>
          <label>本地时间<input required type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label>
          <label>重复<select value={repeat} onChange={e => setRepeat(e.target.value as ReminderRepeat)}><option value="once">仅一次</option><option value="daily">每天</option><option value="weekly">每周</option></select></label>
        </div>
        <label>关联知识<select value={knowledgeId} onChange={e => setKnowledgeId(e.target.value)}><option value="">不关联</option>{state.knowledge.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        {kind === 'reflection' && <label>跟进哪次复盘<select value={reviewId} onChange={e => setReviewId(e.target.value)}><option value="">生成时最近的一次</option>{review.reviews.map(item => <option key={item.id} value={item.id}>{item.date} · {item.summary?.slice(0, 45) ?? '复盘'}</option>)}</select></label>}
        <button className="cozy-btn-primary" disabled={state.busy}>保存提醒</button>
      </form>
      <p className="learning-caption">重复提醒在你完成或跳过本次后安排下一次；延后不会改变原来的每日／每周时间。</p>
      <label className="learning-checkbox"><input type="checkbox" checked={state.delivery?.enabled ?? false} disabled={state.busy} onChange={e => void state.enableSystem(e.target.checked)} />应用退出后也使用 Windows 系统提醒</label>
      <p role="status">{state.delivery?.message ?? '正在读取提醒设置…'}</p>
      {state.delivery && (state.delivery.enabled || !state.delivery.supported) && <button type="button" className="cozy-btn-secondary" disabled={state.busy} onClick={() => void state.retrySystem()}>重新同步系统提醒</button>}
      {state.error && <p role="alert" className="learning-error">{state.error}</p>}
    </section>
    <section className="learning-section">
      <h3>待处理提醒</h3>
      <p className="learning-caption">结合提醒生成的是今日复盘草稿，确认后才保存；同日再次确认会更新今日复盘。拒绝或取消草稿不会完成提醒。</p>
      <label className="learning-checkbox"><input type="checkbox" checked={showFinished} onChange={e => setShowFinished(e.target.checked)} />显示已完成、已跳过和已停止</label>
      {reminders.length === 0 && <p>还没有待处理的提醒。</p>}
      {reminders.map(item => {
        const dueNow = Date.parse(item.dueAt) <= state.clock;
        return <article key={item.id} className="learning-card" data-due={dueNow && item.state === 'scheduled'}>
          <h4>{item.title}</h4><p>{formatTime(item.dueAt)} · {item.state === 'scheduled' ? dueNow ? '已到期，等待你处理' : '已安排' : { completed: '已完成', skipped: '已跳过', stopped: '已停止' }[item.state]}</p>
          {item.state === 'scheduled' && <div className="learning-actions">
            <button className="cozy-btn-primary" disabled={state.busy} onClick={() => void state.act(item, 'complete')}>本次已完成</button>
            <button className="cozy-btn-secondary" disabled={state.busy} onClick={() => void state.act(item, 'snooze', new Date(Math.max(Date.now(), Date.parse(item.dueAt)) + 10 * 60000).toISOString())}>延后 10 分钟</button>
            <button className="cozy-btn-secondary" disabled={state.busy} onClick={() => void state.act(item, 'snooze', new Date(Math.max(Date.now(), Date.parse(item.dueAt)) + 60 * 60000).toISOString())}>延后 1 小时</button>
            <button className="cozy-btn-secondary" disabled={state.busy} onClick={() => void state.act(item, 'skip')}>跳过本次</button>
            <button className="cozy-btn-secondary" disabled={state.busy} onClick={() => void state.act(item, 'stop')}>停止提醒</button>
            {item.kind !== 'study' && <button className="cozy-btn-secondary" disabled={review.generating || state.busy} onClick={() => void review.generateLearning(item.id).then(() => state.refresh())}>结合上次建议生成复盘</button>}
            {item.knowledgeId && <button className="cozy-btn-secondary" onClick={() => { const knowledge = state.knowledge.find(entry => entry.id === item.knowledgeId); if (knowledge) chooseKnowledge(knowledge); }}>记录这次回忆结果</button>}
          </div>}
          {item.history.length > 0 && <details><summary>处理记录（{item.history.length}）</summary>{item.history.slice(-8).reverse().map((entry, index) => <p key={index}>{formatTime(entry.at)} · {{ snooze: '延后', skip: '跳过', complete: '完成', stop: '停止' }[entry.action]}</p>)}</details>}
        </article>;
      })}
      {review.generating && <p role="status">正在整理复盘草稿… {review.canCancel && <button className="cozy-btn-secondary" onClick={review.cancelGeneration}>取消生成</button>}</p>}
      {(review.error || review.lastOutcome) && <p role="status">{review.error ?? review.lastOutcome}</p>}
    </section>
    <section className="learning-section">
      <h3>知识回忆与困难点</h3><p>这里记录你的自评。完成任务或专注计时不代表掌握；时间过去也不会被自动判成遗忘。</p>
      <form ref={knowledgeForm} onSubmit={event => { event.preventDefault(); void (async () => {
        if (await state.record({ id: selected?.id, revision: selected?.revision, title: topic, noteId: noteId || undefined, rating, difficulty, result })) {
          setSelected(undefined); setTopic(''); setNoteId(''); setDifficulty(''); setResult('');
        }
      })(); }}>
        <label>{selected ? '追加自评：' : '知识名称'}<input required maxLength={120} value={topic} onChange={e => setTopic(e.target.value)} /></label>
        <label>关联笔记<select disabled={Boolean(selected)} value={noteId} onChange={e => setNoteId(e.target.value)}><option value="">不关联</option>{notes.map(note => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label>
        <label>本次自评<select value={rating} onChange={e => setRating(e.target.value as RecallRating)}>{Object.entries(ratings).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>困难点<textarea maxLength={1000} value={difficulty} onChange={e => setDifficulty(e.target.value)} placeholder="例如：还不能解释为何必须有序" /></label>
        <label>这次尝试与结果<textarea maxLength={1000} value={result} onChange={e => setResult(e.target.value)} placeholder="例如：合上资料复述，遗漏了边界条件" /></label>
        <div className="learning-actions"><button className="cozy-btn-primary" disabled={state.busy}>保存本次自评</button>{selected && <button type="button" className="cozy-btn-secondary" onClick={() => { setSelected(undefined); setTopic(''); setNoteId(''); }}>改为新知识</button>}</div>
      </form>
      {state.knowledge.map(item => <article key={item.id} className="learning-card">
        <h4>{item.title}</h4><p>{ratings[item.observations.at(-1)?.rating ?? 'new']} · 上次记录 {formatTime(item.updatedAt)}</p>
        <div className="learning-actions"><button className="cozy-btn-secondary" onClick={() => chooseKnowledge(item)}>追加回忆结果</button><button className="cozy-btn-secondary" onClick={() => { setKnowledgeId(item.id); setReviewId(''); setTitle(`复习：${item.title}`.slice(0, 120)); setKind('review'); setDue(localTime(new Date(Date.now() + 3600000))); reminderForm.current?.scrollIntoView({ block: 'start' }); }}>安排复习提醒</button></div>
        <details><summary>自评变化（{item.observations.length} 次）</summary>{item.observations.slice().reverse().map((entry, index) => <div key={index}><p>{formatTime(entry.at)} · {ratings[entry.rating]}</p>{entry.difficulty && <p>困难：{entry.difficulty}</p>}{entry.result && <p>结果：{entry.result}</p>}</div>)}</details>
      </article>)}
    </section>
  </div>;
}
