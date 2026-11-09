import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionInteraction } from '@shared-types/domain';

const mocks = vi.hoisted(() => ({ trigger: vi.fn(), proactive: vi.fn(), respond: vi.fn(), play: vi.fn() }));
vi.mock('../../../src/ui/stores/runtime', () => ({
  useCases: { triggerInteraction: { execute: mocks.trigger }, proactiveCompanionTick: { execute: mocks.proactive }, handleUserResponse: { execute: mocks.respond } },
  repositories: { companionInteraction: { listAll: async () => [] } },
  audioPlayer: { play: mocks.play }, eventBus: {}, describeError: String,
}));
vi.mock('../../../src/ui/stores/focus-store', () => ({ useFocusStore: { getState: () => ({ active: null }) } }));
vi.mock('../../../src/ui/stores/settings-store', () => ({ useSettingsStore: { getState: () => ({ companion: { enabled: true } }) } }));
import { useCompanionStore } from '@ui/stores/companion-store';

const question = { id: 'q', content: 'Question', requiresResponse: true, sceneType: 'user_invoked' } as CompanionInteraction;
describe('quiet companion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanionStore.setState({ current: null, surfaceBusy: true, generating: false, quickReplies: [], turnCount: 0, conversationState: { kind: 'idle' } });
  });
  it('suppresses automatic model work when the user is busy, but allows an explicit request silently', async () => {
    await useCompanionStore.getState().trigger('idle');
    await useCompanionStore.getState().proactiveTick();
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.proactive).not.toHaveBeenCalled();
    mocks.trigger.mockResolvedValue(question);
    await useCompanionStore.getState().trigger('user_invoked');
    expect(useCompanionStore.getState().current).toEqual(question);
    expect(mocks.play).not.toHaveBeenCalled();
  });
  it('does not repeat a pending question or lose its suggested replies on duplicate delivery', async () => {
    const state = useCompanionStore.getState();
    state.setSurfaceBusy(false);
    state.showInteraction(question, ['Later']);
    state.showInteraction(question);
    expect(useCompanionStore.getState().quickReplies).toEqual(['Later']);
    await state.proactiveTick();
    expect(mocks.proactive).not.toHaveBeenCalled();
  });
  it('deduplicates simultaneous user requests and enters asking after a response', async () => {
    let finish!: (q: CompanionInteraction) => void;
    mocks.trigger.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = useCompanionStore.getState().trigger('user_invoked');
    await useCompanionStore.getState().trigger('user_invoked');
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
    finish(question); await first;
    mocks.respond.mockResolvedValue({ ...question, id: 'follow-up' });
    await useCompanionStore.getState().respond('My answer');
    expect(useCompanionStore.getState()).toMatchObject({ generating: false, current: { id: 'follow-up' }, conversationState: { kind: 'asking' }, turnCount: 1 });
  });
});
