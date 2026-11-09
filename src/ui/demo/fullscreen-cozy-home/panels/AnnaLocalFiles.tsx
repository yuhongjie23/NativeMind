import { useAnnaFileTransfer } from '../../../hooks/use-anna-file-transfer';
import { AnnaTransferStatus } from '../../../components/common/AnnaTransferStatus';
import { useState } from 'react';
import { pickAnnaAudio } from '@infrastructure/anna';
import { useMusicStore } from '../../../stores/music-store';
import { describeError } from '../../../stores/runtime';
import { useT } from '../../../i18n';

export function AnnaLocalFiles({ dataDir }: { dataDir: string }) {
  const t = useT();
  const fileTransfer = useAnnaFileTransfer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const importAudio = async () => {
    setBusy(true);
    setMessage('');
    try {
      const file = await pickAnnaAudio();
      if (!file) return;
      const path = await fileTransfer.stage(file, 'audio');
      if (!path) return;
      await useMusicStore.getState().refresh();
      setMessage(t('已加入音乐库：{0}', file.name));
    } catch (error) {
      setMessage(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return <section className="cozy-settings__group">
    <h3 className="cozy-settings__group-title">{t('Anna 文件与音乐')}</h3>
    <p className="cozy-companion-panel__hint">{t('数据保存在 Anna 独立目录。文档请到知识页选择导入；音频导入后可用于音乐库、天气背景和专注。')}</p>
    <p className="cozy-companion-panel__hint"><code>{dataDir}</code></p>
    <button type="button" className="cozy-btn-secondary" disabled={busy} onClick={() => void importAudio()}>
      {busy ? t('导入中…') : t('导入音乐…')}
    </button>
    <p className="cozy-companion-panel__hint">{t('支持 MP3、FLAC、WAV、OGG、M4A，单个文件不超过 32 MB。')}</p>
    <AnnaTransferStatus transfer={fileTransfer} />
    {message && <p role="status" className="cozy-companion-panel__hint">{message}</p>}
  </section>;
}
