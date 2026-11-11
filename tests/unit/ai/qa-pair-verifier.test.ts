import { describe, expect, it, vi } from 'vitest';
import { verifyEvidencePair } from '@ai/rag/qa-pair-verifier';
import { ModelRouter } from '@ai/router/model-router';
import type { ModelCompletionRequest } from '@ai/types';

const pair = { claim: 'Cooling causes higher recovery.', quote: 'Recovery is higher.' };
describe('isolated evidence verification', () => {
  const setup = (first: string, second: string) => {
    const complete = vi.fn(async (request: ModelCompletionRequest) =>
      (request.jsonSchema as { $id: string }).$id === 'qa-evidence-check.v1' ? first : second);
    return { complete, router: new ModelRouter({ isAvailable: async () => true, complete }) };
  };
  it.each([
    { missing: 'cause', verdict: 'partial' },
    { missing: 'cause', verdict: 'supported' },
    { missing: '', verdict: 'unsupported' },
  ])('does not let the first approval override a missing fact: %j', async verdict => {
    const { router } = setup('{"supported":[true]}', JSON.stringify(verdict));
    expect(await verifyEvidencePair(router, pair, new AbortController().signal)).toBe(false);
  });
  it('keeps each pair isolated and uses the same cancellation signal for both checks', async () => {
    const { router, complete } = setup('{"supported":[true]}', '{"missing":"","verdict":"supported"}');
    const signal = new AbortController().signal;
    expect(await verifyEvidencePair(router, pair, signal)).toBe(true);
    expect(await verifyEvidencePair(router, { claim: 'Second claim.', quote: 'Second source.' }, signal)).toBe(true);
    for (const [request] of complete.mock.calls) expect(request.signal).toBe(signal);
    expect(complete.mock.calls[0][0].prompt).not.toContain('Second source');
    expect(complete.mock.calls[2][0].prompt).not.toContain('Recovery');
    expect(JSON.parse(complete.mock.calls[0][0].prompt)).toEqual([pair]);
    expect(JSON.parse(complete.mock.calls[1][0].prompt)).toEqual(pair);
  });
  it('does not ask another check to overrule an explicit rejection', async () => {
    const { router, complete } = setup('{"supported":[false]}', '{"missing":"","verdict":"supported"}');
    expect(await verifyEvidencePair(router, pair, new AbortController().signal)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(['{broken', '{"verdict":"supported"}', '{"missing":"","verdict":"maybe"}'])(
    'reports unavailable instead of approving malformed output: %s', async second => {
      const { router, complete } = setup('{"supported":[true]}', second);
      expect(await verifyEvidencePair(router, pair, new AbortController().signal)).toBeUndefined();
      expect(complete).toHaveBeenCalledTimes(2);
    });
  it('does not start after cancellation', async () => {
    const { router, complete } = setup('', '');
    const controller = new AbortController(); controller.abort();
    await expect(verifyEvidencePair(router, pair, controller.signal)).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});
