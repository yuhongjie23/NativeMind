/**
 * 简单确认弹窗（删除等破坏性操作）
 *
 * 与写入确认（ConfirmationModal）区分：不落 action_proposal、没有「写入」语义，
 * 确认后直接执行删除。dismissible={false}：必须显式点「取消 / 删除」。
 */
import { useConfirmationStore } from '../../stores/confirmation-store';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

export function SimpleConfirmModal() {
  const simple = useConfirmationStore((state) => state.simple);
  const decide = useConfirmationStore((state) => state.decideSimple);

  if (!simple) return null;

  return (
    <Modal
      dismissible={false}
      footer={
        <>
          <Button onClick={() => decide(false)} variant="ghost">
            取消
          </Button>
          <Button
            className={simple.danger ? 'btn-danger' : undefined}
            onClick={() => decide(true)}
            variant="primary"
          >
            {simple.confirmLabel ?? '确认'}
          </Button>
        </>
      }
      open
      title={simple.title}
    >
      <p className="confirm-summary">{simple.message}</p>
    </Modal>
  );
}
