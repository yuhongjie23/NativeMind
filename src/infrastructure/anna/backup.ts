import { annaInvoke } from './bridge';

export interface AnnaBackup { id: string; path: string }
export type AnnaRestoreStatus =
  | { state: 'idle' }
  | { state: 'pending'; backupId: string; safety: AnnaBackup }
  | { state: 'restored' | 'failed'; backupId: string | null; safety: AnnaBackup | null; finishedAt: string; error: string | null };
export const getAnnaRestoreStatus = (): Promise<AnnaRestoreStatus> => annaInvoke('data_restore_status');
export const exportAnnaBackup = (): Promise<AnnaBackup> => annaInvoke('data_export_local');
export const listAnnaBackups = (): Promise<AnnaBackup[]> => annaInvoke('data_list_exports');
export const importAnnaBackup = (path: string): Promise<AnnaBackup> => annaInvoke('data_import_local', { path });
export const restoreAnnaBackup = (id: string): Promise<{ restartRequired: true; safety: AnnaBackup }> =>
  annaInvoke('data_restore_local', { id });
