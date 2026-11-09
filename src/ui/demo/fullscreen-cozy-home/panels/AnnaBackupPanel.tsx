import { useEffect, useState } from 'react';
import { exportAnnaBackup, getAnnaRestoreStatus, importAnnaBackup, listAnnaBackups, restoreAnnaBackup, type AnnaBackup, type AnnaRestoreStatus } from '@infrastructure/anna/backup';
import { useConfirmationStore } from '../../../stores/confirmation-store';
import { describeError } from '../../../stores/runtime';

export function AnnaBackupPanel() {
  const [backups, setBackups] = useState<AnnaBackup[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [restart, setRestart] = useState(false);
  const [message, setMessage] = useState('');
  const [importPath, setImportPath] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<AnnaRestoreStatus>({ state: 'idle' });
  useEffect(() => {
    let active = true;
    void Promise.allSettled([getAnnaRestoreStatus(), listAnnaBackups()]).then(([statusResult, backupsResult]) => {
      if (!active) return;
      if (statusResult.status === 'fulfilled') {
        setRestoreStatus(statusResult.value);
        setRestart(statusResult.value.state === 'pending');
        if (statusResult.value.state === 'pending') return;
      } else setMessage(describeError(statusResult.reason));
      if (backupsResult.status === 'fulfilled') setBackups(backupsResult.value);
      else setMessage(describeError(backupsResult.reason));
    });
    return () => { active = false; };
  }, []);
  const exportData = async () => {
    setBusy(true);
    try {
      const backup = await exportAnnaBackup();
      setMessage(`已保存完整本地备份：${backup.path}`);
      setBackups(await listAnnaBackups());
      setSelected(backup.id);
    } catch (error) { setMessage(describeError(error)); }
    finally { setBusy(false); }
  };
  const importData = async () => {
    setBusy(true);
    try {
      const backup = await importAnnaBackup(importPath.trim());
      setMessage(`备份已复制到本机：${backup.path}。选择“恢复所选备份”后才会替换当前数据。`);
      setBackups(await listAnnaBackups());
      setSelected(backup.id);
    } catch (error) { setMessage(describeError(error)); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const confirmed = await useConfirmationStore.getState().requestSimple({
        title: '恢复 Anna 本地备份',
        message: '当前数据会先另存完整备份。确认后暂停数据操作，重启 Anna 开发环境时恢复到所选备份。',
      });
      if (!confirmed) return;
      const result = await restoreAnnaBackup(selected);
      setRestoreStatus({ state: 'pending', backupId: selected, safety: result.safety });
      setRestart(true);
      setMessage(`恢复已准备好，请重启 Anna 开发环境。当前数据已备份到：${result.safety.path}`);
    } catch (error) { setMessage(describeError(error)); }
    finally { setBusy(false); }
  };
  return <section className="cozy-settings__group">
    <h3 className="cozy-settings__group-title">Anna 本地备份与恢复</h3>
    {restoreStatus.state !== 'idle' && <div role={restoreStatus.state === 'failed' ? 'alert' : 'status'} className="cozy-companion-panel__hint">
      <p>{restoreStatus.state === 'pending' ? '恢复已准备好，请重启 Anna 本地环境。' : restoreStatus.state === 'restored' ? '上次备份恢复已完成。' : '上次恢复未完成，当前数据库未被替换。请检查备份后重新选择恢复。'}</p>
      {restoreStatus.state !== 'pending' && <p>{restoreStatus.finishedAt}</p>}
      {restoreStatus.state === 'failed' && restoreStatus.error && <p>{restoreStatus.error}</p>}
      {restoreStatus.safety && <p>恢复前安全备份：{restoreStatus.safety.path}</p>}
    </div>}
    <p className="cozy-companion-panel__hint">完整备份包含数据库、导入文档、音乐和自定义背景视频。搬迁时复制整个备份文件夹到新电脑，再填写本地目录导入；恢复时自动修复文档、音乐和视频路径。所有操作在本机完成，不上传云端。模型不包含在备份中。</p>
    <button className="cozy-btn-secondary" disabled={busy || restart} onClick={() => void exportData()}>生成完整备份</button>
    <div className="anna-backup-controls">
      <label>本地备份文件夹
        <input className="cozy-model-field__input" value={importPath} disabled={busy || restart} onChange={event => setImportPath(event.target.value)} placeholder="包含 complete.json 的文件夹完整路径" />
      </label>
      <button className="cozy-btn-secondary" disabled={!importPath.trim() || busy || restart} onClick={() => void importData()}>导入本地备份</button>
    </div>
    <div className="anna-backup-controls">
      <label>选择备份
        <select className="cozy-model-field__input" aria-label="选择 Anna 备份" value={selected} disabled={busy || restart} onChange={event => setSelected(event.target.value)}>
          <option value="">选择备份</option>
          {backups.map(backup => <option key={backup.id} value={backup.id}>{backup.id}</option>)}
        </select>
      </label>
      <button className="cozy-btn-secondary" disabled={!selected || busy || restart} onClick={() => void restore()}>恢复所选备份</button>
    </div>
    {message && <p role="status" className="cozy-companion-panel__hint">{message}</p>}
  </section>;
}
