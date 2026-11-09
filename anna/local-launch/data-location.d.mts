export function launcherProfilePath(localAppData?: string): string;
export function validateDataDirectory(value: string, packageRoot: string): string;
export function readLauncherProfile(path: string): Promise<{ format: 1; dataDirectory: string } | null>;
export function selectDataDirectory(options: { explicit?: string; environment?: string; profilePath: string; packageRoot: string }): Promise<{
  dataDirectory: string; source: 'argument' | 'environment' | 'profile'; exists: boolean; databaseExists: boolean;
}>;
export function prepareDataDirectory(dataDirectory: string): Promise<void>;
export function rememberDataDirectory(profilePath: string, dataDirectory: string): Promise<void>;
