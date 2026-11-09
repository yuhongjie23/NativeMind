import type { useAnnaFileTransfer } from '../../hooks/use-anna-file-transfer';
import { useT } from '../../i18n';

export function AnnaTransferStatus({ transfer }: { transfer: ReturnType<typeof useAnnaFileTransfer> }) {
  const t = useT();
  const { state } = transfer;
  if (state.phase === 'idle') return null;
  if (state.phase === 'cancelled') return <p role="status">{t('已取消文件传输，未加入文件。')}</p>;
  if (!('bytes' in state)) return null;
  const percent = state.total ? Math.floor(state.bytes * 100 / state.total) : 0;
  return <div>
    <p role="status">{state.phase === 'committing' ? t('正在完成本地保存…')
      : state.phase === 'cancelling' ? t('正在停止并清理临时文件…')
        : t('正在复制到本机：{0}%', percent)}</p>
    <progress aria-label={t('本地文件传输进度')} max={state.total || 1} value={state.bytes} />
    <button type="button" className="cozy-btn-secondary" disabled={state.phase !== 'transferring'} onClick={transfer.cancel}>
      {t('取消文件传输')}
    </button>
  </div>;
}
