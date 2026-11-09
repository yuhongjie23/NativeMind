export interface PrerequisiteCheck { id: string; required: boolean; ok: boolean; message: string }
export function findNpxCli(nodePath: string, npmPath?: string): Promise<string | null>;
export function assessPrerequisites(input: { nodeVersion: string; platform: string; arch: string; packagePlatform: string; packageArch: string; uvAvailable: boolean; npxCli: string | null }): PrerequisiteCheck[];
export function checkUv(): boolean;
export function checkOllama(fetcher?: typeof fetch): Promise<PrerequisiteCheck[]>;
