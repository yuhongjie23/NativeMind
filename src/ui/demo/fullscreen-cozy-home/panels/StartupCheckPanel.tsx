import { useState } from 'react';
import { modelDownloadCommand } from '@infrastructure/startup-check';
import { DEFAULT_EMBEDDING_MODEL } from '@infrastructure/model-runtime/tauri-model-provider';
import { useStartupCheckStore } from '../../../stores/startup-check-store';
import { modelInstallationStatus, useModelReadinessStore } from '../../../stores/model-readiness-store';
import { useSettingsStore } from '../../../stores/settings-store';
import { useT } from '../../../i18n';

function CopyCommand({ command }: { command: string }) {
  const t = useT();
  const [status, setStatus] = useState('');
  return <div className="startup-check__command">
    <code>{command}</code>
    <button type="button" className="cozy-btn-ghost" onClick={() => {
      void (async () => {
        try { await navigator.clipboard.writeText(command); setStatus('已复制'); }
        catch { setStatus('复制失败，请选中上方命令手动复制'); }
      })();
    }}>{t(command.startsWith('ollama pull ') ? '复制下载命令' : '复制启动命令')}</button>
    {status && <span role="status">{t(status)}</span>}
  </div>;
}

export function useStartupIssues(): boolean {
  const phase = useStartupCheckStore(state => state.phase);
  const storage = useStartupCheckStore(state => state.storage);
  const inventory = useModelReadinessStore(state => state.inventory);
  const models = useSettingsStore(state => state.models);
  if (phase !== 'done') return false;
  return storage.state !== 'done' || !storage.result.writable || inventory.state === 'error'
    || [models.small, models.big, DEFAULT_EMBEDDING_MODEL].some(name => modelInstallationStatus(inventory, name) === 'missing');
}

export function StartupCheckNotice({ onOpen }: { onOpen: () => void }) {
  const issues = useStartupIssues();
  const dismissed = useStartupCheckStore(state => state.dismissed);
  const t = useT();
  if (!issues || dismissed) return null;
  return <aside className="startup-check-notice" aria-label={t('启动检查提醒')}>
    <span>{t('本地环境有项目需要处理')}</span>
    <button type="button" onClick={onOpen}>{t('查看启动检查')}</button>
    <button type="button" aria-label={t('收起启动提醒')} onClick={() => useStartupCheckStore.getState().dismiss()}>×</button>
  </aside>;
}

export function StartupCheckPanel() {
  const t = useT();
  const state = useStartupCheckStore();
  const inventory = useModelReadinessStore(s => s.inventory);
  const models = useSettingsStore(s => s.models);
  const issues = useStartupIssues();
  const busy = state.phase === 'checking' || inventory.state === 'checking';
  const modelRow = (label: string, name: string) => {
    const status = modelInstallationStatus(inventory, name);
    const command = modelDownloadCommand(name);
    return <li key={label}>
      <strong>{t(label)}</strong> <code>{name || t('未选择模型')}</code>
      <span>{t(status === 'ok' ? '已安装' : status === 'missing' ? (name ? '未安装' : '请在下方模型设置中选择') : status === 'checking' ? '检查中…' : '等待服务连接后检查')}</span>
      {status === 'missing' && label !== '知识检索向量模型' && <button type="button" className="cozy-btn-ghost" onClick={() => document.getElementById(label === '生成模型' ? 'quick-model' : 'coach-model')?.focus()}>{t('选择模型')}</button>}
      {status === 'missing' && command && <CopyCommand key={command} command={command} />}
    </li>;
  };
  return <section id="startup-check" className="cozy-settings__group startup-check" aria-label={t('启动检查')}>
    <div className="startup-check__header">
      <h3 className="cozy-settings__group-title">{t('启动检查')}</h3>
      {state.phase !== 'unsupported' && <button type="button" className="cozy-btn-secondary" disabled={busy} onClick={() => { void state.check(); }}>{t('重新检查')}</button>}
    </div>
    {state.phase === 'unsupported' ? <p>{t('网页演示不连接本机模型，也不保存本地数据；请使用桌面或 Anna 本地版。')}</p> : <>
      <p role="status">{t(busy ? '正在检查本地环境…' : state.phase === 'idle' ? '等待启动检查' : issues ? '请处理以下项目后重新检查' : '基础检查通过')}</p>
      <ul className="startup-check__items">
        <li><strong>{t('本地模型服务 (Ollama)')}</strong>
          <span>{t(state.startingService ? '启动中…' : inventory.state === 'ready' ? '运行中 ✓' : inventory.state === 'error' ? '无法连接服务' : '检查中…')}</span>
          {inventory.state === 'error' && <>
            <button type="button" className="cozy-btn-secondary" disabled={busy} onClick={() => { void state.check(true); }}>{t('启动服务')}</button>
            <p className="cozy-companion-panel__hint">{t('请确认已安装 Ollama；启动失败时可在终端运行下方命令，然后重新检查。')}</p>
            <CopyCommand command="ollama serve" />
            <details><summary>{t('错误详情')}</summary><p>{inventory.message}</p></details>
          </>}
        </li>
        {modelRow('生成模型', models.small)}
        {models.big !== models.small && modelRow('教练生成模型', models.big)}
        {modelRow('知识检索向量模型', DEFAULT_EMBEDDING_MODEL)}
        <li><strong>{t('数据目录')}</strong>
          {state.storage.state === 'done' ? <>
            <code>{state.storage.result.path}</code>
            <span>{t(state.storage.result.writable ? '可写' : '无法写入')}</span>
            {!state.storage.result.writable && <>
              <p>{t('请检查该目录的写入权限和磁盘剩余空间，修复后点击重新检查。')}</p>
              <details><summary>{t('错误详情')}</summary>{state.storage.result.reason}</details>
            </>}
          </> : state.storage.state === 'error' ? <>
            <p>{t('无法检查数据目录，请重启本地服务后重新检查。')}</p>
            <details><summary>{t('错误详情')}</summary>{state.storage.message}</details>
          </> : <span>{t('检查中…')}</span>}
        </li>
      </ul>
      <p className="cozy-companion-panel__hint">{t('模型检查只核对安装情况，不运行生成或向量任务。不会自动下载模型，也不会上传数据。')}</p>
    </>}
  </section>;
}
