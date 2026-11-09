import { beforeEach, describe, expect, it } from 'vitest';
import { createProposal } from '@application/confirmation/action-proposal';
import { useConfirmationStore } from '../../../src/ui/stores/confirmation-store';

const proposal = () => createProposal({ actionType: 'generate_review', summary: 'draft', payload: {} });
describe('cancelling a confirmation queue entry', () => {
  beforeEach(() => useConfirmationStore.setState({ pending: null, queue: [] }));
  it.each([true, false])('removes only the aborted entry (active=%s)', async active => {
    const a = proposal();
    const b = proposal();
    const controller = new AbortController();
    const first = useConfirmationStore.getState().request(a, active ? controller.signal : undefined);
    const second = useConfirmationStore.getState().request(b, active ? undefined : controller.signal);
    controller.abort();
    expect(await (active ? first : second)).toBe(false);
    expect(useConfirmationStore.getState().pending?.proposal.id).toBe(active ? b.id : a.id);
    expect(useConfirmationStore.getState().queue).toEqual([]);
    useConfirmationStore.getState().decide(true);
    expect(await (active ? second : first)).toBe(true);
  });
  it('never queues an already cancelled proposal', async () => {
    expect(await useConfirmationStore.getState().request(proposal(), AbortSignal.abort())).toBe(false);
    expect(useConfirmationStore.getState().pending).toBeNull();
  });
});
