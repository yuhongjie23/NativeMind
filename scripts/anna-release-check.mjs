import { annaReleaseAssessment, verifyAnnaPackage } from './lib/verify-anna-package.mjs';
import { checkAnnaBundle } from './lib/check-anna-bundle.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--package')) {
  console.error('用法：npm run anna:release-check -- [--package <本机验证包目录>]');
  process.exitCode = 1;
} else {
  try {
    const integrity = args.length ? { state: 'verified', ...await verifyAnnaPackage(args[1]) } : { state: 'not-checked', reason: '未指定验证包。' };
    const bundle = args.length ? await checkAnnaBundle(join(args[1], 'bundle')) : { state: 'not-checked' };
    console.log(JSON.stringify({ ...annaReleaseAssessment(integrity), uiBundle: bundle }, null, 2));
    // A deliberate failure for release pipelines: do not interpret a local build as publishable.
    process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
