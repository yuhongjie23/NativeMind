export interface PackageIntegrity {
  format: 1;
  mode: 'local-development';
  platform: 'win32' | 'darwin' | 'linux';
  arch: 'x64' | 'arm64';
  profile: 'debug' | 'release';
  filesVerified: number;
}
export function verifyAnnaPackage(directory: string): Promise<PackageIntegrity>;
export function annaReleaseAssessment(packageIntegrity: Record<string, unknown>): {
  stage: 'local-verification';
  publishReady: false;
  packageIntegrity: Record<string, unknown>;
  blockers: { id: string; owner: string; detail: string }[];
  note: string;
};
