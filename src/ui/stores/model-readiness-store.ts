import { create } from 'zustand';
import { listInstalledModels, type InstalledModelInfo } from '@infrastructure/paths/paths-api';

type ModelInventory =
  | { state: 'idle' }
  | { state: 'checking'; models: InstalledModelInfo[] }
  | { state: 'ready'; models: InstalledModelInfo[] }
  | { state: 'error'; message: string };

export type ModelInstallationStatus = 'idle' | 'checking' | 'ok' | 'missing' | 'error';

/** Check the selected name against the latest successful inventory, never a previous selection. */
export function modelInstallationStatus(inventory: ModelInventory, name: string): ModelInstallationStatus {
  if (inventory.state !== 'ready') return inventory.state;
  const canonical = (value: string) => value.trim().replace(/:latest$/, '');
  const target = canonical(name);
  return target && inventory.models.some(model => canonical(model.name) === target) ? 'ok' : 'missing';
}

let generation = 0;
export const useModelReadinessStore = create<{
  inventory: ModelInventory;
  refresh: () => Promise<void>;
}>((set, get) => ({
  inventory: { state: 'idle' },
  refresh: async () => {
    const current = ++generation;
    const previous = get().inventory;
    set({ inventory: { state: 'checking', models: previous.state === 'ready' || previous.state === 'checking' ? previous.models : [] } });
    try {
      const models = await listInstalledModels();
      if (current === generation) set({ inventory: { state: 'ready', models } });
    } catch (error) {
      if (current === generation) set({ inventory: { state: 'error', message: error instanceof Error ? error.message : String(error) } });
    }
  },
}));
