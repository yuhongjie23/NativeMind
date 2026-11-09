import type { GenerationOptions, ReviewEvidenceSource, ReviewObservation } from '@application/ports';
import type { ModelRouter } from '../router/model-router';

interface Verdict {
  accepted: Array<{ kind: 'observation' | 'suggestion'; index: number; evidenceId: string; quote: string }>;
}

/** Model judgement is supplemented by exact source/quote checks; failure never keeps a draft. */
export async function verifyReview(router: ModelRouter, sources: ReviewEvidenceSource[],
  observations: ReviewObservation[], suggestions: ReviewObservation[], options?: GenerationOptions
): Promise<{ observations: ReviewObservation[]; suggestions: ReviewObservation[]; available: boolean }> {
  // Numeric/coverage observations are already rendered deterministically. Ask the model
  // only about concrete task/self-report observations, never about missing telemetry.
  observations = observations.filter(entry => entry.evidenceIds.some(id => sources.some(source => source.id === id
    && ['task', 'follow_up', 'knowledge'].includes(source.kind)))
    && !/(?:应用使用|使用时长|缺少|缺乏|未记录|没有记录|未安排|没有安排|未使用应用|没有学习)/u.test(entry.text));
  // Missing metadata must not create busywork masquerading as a learning suggestion.
  suggestions = suggestions.filter(entry => !/(?:补[充写录].{0,8}(?:计时|专注|日志)|应用使用|完成时间|完成日期|是否.{0,12}(?:完成|区间))/u.test(entry.text));
  if (!observations.length && !suggestions.length) return { observations: [], suggestions: [], available: true };
  const result = await router.run<unknown, Verdict>({
    taskType: 'review_check', input: { observations, suggestions }, signal: options?.signal,
    modelPolicy: { temperature: 0, maxTokens: 1200, noRetry: true, noFallback: true },
    promptVars: { sources: JSON.stringify(sources), candidates: JSON.stringify({ observations, suggestions }) },
  });
  if (!result.ok || !result.output) return { observations: [], suggestions: [], available: false };
  const accepted = { observation: new Map<number, { quote: string; sourceId: string }>(), suggestion: new Map<number, string>() };
  for (const verdict of result.output.accepted) {
    const entry = (verdict.kind === 'observation' ? observations : suggestions)[verdict.index];
    const source = sources.find(item => item.id === verdict.evidenceId);
    if (!entry || !source || !entry.evidenceIds.includes(source.id)
      || verdict.quote.trim().length < 4 || !source.description.includes(verdict.quote)) continue;
    if (source.kind === 'coverage') continue;
    if (verdict.kind === 'suggestion' && !['task', 'follow_up', 'knowledge'].includes(source.kind)) continue;
    if (verdict.kind === 'observation') accepted.observation.set(verdict.index, { quote: verdict.quote, sourceId: source.id });
    else accepted.suggestion.set(verdict.index, source.id);
  }
  return { observations: observations.flatMap((entry, index) => {
    const acceptedSource = accepted.observation.get(index);
    // Extractive observations cannot silently turn recorded facts into stronger claims.
    return acceptedSource ? [{ ...entry, text: `资料记录：「${acceptedSource.quote}」`, evidenceIds: [acceptedSource.sourceId] }] : [];
  }),
    suggestions: suggestions.flatMap((entry, index) => {
      const sourceId = accepted.suggestion.get(index);
      return sourceId ? [{ ...entry, evidenceIds: [sourceId] }] : [];
    }), available: true };
}
