export interface BundleAssessment { valid: boolean; fileCount: number; totalBytes: number; errors: string[] }
export const bundleLimits: { totalBytes: number; fileBytes: number; files: number };
export function assessBundleFiles(files: { path: string; bytes: number }[]): BundleAssessment;
export function checkAnnaBundle(root: string): Promise<BundleAssessment>;
