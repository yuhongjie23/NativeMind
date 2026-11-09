import { create } from 'zustand';
import { checkStorage, supportsStartupCheck, type StorageCheck } from '@infrastructure/startup-check';
import { ensureOllamaRunning } from '@infrastructure/paths/paths-api';
import { useModelReadinessStore } from './model-readiness-store';

type StorageState = { state: 'idle' | 'checking' } | { state: 'done'; result: StorageCheck } | { state: 'error'; message: string };
interface StartupCheckState {
  phase: 'idle' | 'checking' | 'done' | 'unsupported';
  storage: StorageState;
  startingService: boolean;
  startFailed: boolean;
  dismissed: boolean;
  dismiss: () => void;
  check: (startService?: boolean) => Promise<void>;
}
let inFlight: Promise<void> | undefined;
export const useStartupCheckStore = create<StartupCheckState>((set) => ({
  phase: 'idle', storage: { state: 'idle' }, startingService: false, startFailed: false, dismissed: false,
  dismiss: () => set({ dismissed: true }),
  check: (startService = false) => {
    if (inFlight) return inFlight;
    if (!supportsStartupCheck()) { set({ phase: 'unsupported' }); return Promise.resolve(); }
    set({ phase: 'checking', storage: { state: 'checking' }, startingService: startService, startFailed: false });
    inFlight = Promise.all([
      checkStorage().then(result => set({ storage: { state: 'done', result } }), error => set({ storage: { state: 'error', message: String(error) } })),
      (async () => {
        if (startService) {
          const result = await ensureOllamaRunning().catch(() => 'failed' as const);
          set({ startingService: false, startFailed: result === 'failed' });
        }
        await useModelReadinessStore.getState().refresh();
      })(),
    ]).then(() => { set({ phase: 'done' }); }).finally(() => { inFlight = undefined; });
    return inFlight;
  },
}));
