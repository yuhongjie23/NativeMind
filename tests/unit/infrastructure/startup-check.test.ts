import { describe, expect, it } from 'vitest';
import { modelDownloadCommand } from '@infrastructure/startup-check';
describe('model download commands', () => {
  it('copies existing selections without changing the model', () => {
    expect(modelDownloadCommand('qwen3:14b')).toBe('ollama pull qwen3:14b');
    expect(modelDownloadCommand('nomic-embed-text')).toBe('ollama pull nomic-embed-text');
    expect(modelDownloadCommand('org/model:tag')).toBe('ollama pull org/model:tag');
  });
  it.each(['', '--help', 'a; echo bad', '$(bad)', 'a`bad`', 'a\nbad', 'a & bad', '"a"'])('does not put shell expressions in commands: %s', value => {
    expect(modelDownloadCommand(value)).toBeUndefined();
  });
});
