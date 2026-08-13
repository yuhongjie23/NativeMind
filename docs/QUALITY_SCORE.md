# QUALITY_SCORE.md — Quality Metrics & Standards

## Code Quality

### Current State (v0.1.0)

| Metric | Target | Current |
|--------|--------|---------|
| TypeScript strict mode | ✅ | ✅ Enabled |
| ESLint (0 warnings) | ✅ | ✅ Passing (`npm run lint` exit 0) |
| Test coverage (unit) | >60% | Growing |
| Test coverage (integration) | >40% | Growing |
| No `any` types | ✅ | Enforced (lint `no-explicit-any` 0 warnings) |
| Layer isolation | ✅ | Domain pure; UI may import read-only infrastructure utilities (paths-api, audio-library), never DB/SQL |

### Quality Gates (per PR/commit)

1. `npm run typecheck` passes (tsc --noEmit)
2. `npm run lint` passes (0 warnings)
3. `npm test` passes (all tests green)
4. No new `any` types without explicit justification
5. Domain → anything: forbidden; UI → infrastructure limited to read-only utility modules, never business write paths
6. AI-suggested writes go through ConfirmationService; user-initiated writes are direct (user action = confirmation)

## AI Output Quality

### JSON Schema Validation
All AI responses are validated against versioned JSON schemas (`src/ai/schemas/*.v1.json`):
- `json-validator.ts` — structural validation (draft-07 subset, zero-dependency)

### Quality Dimensions

| Dimension | Measure | Threshold |
|-----------|---------|-----------|
| Schema compliance | Valid JSON + all required fields | 100% |
| Relevance | RAG retrieval score | >0.7 |
| Actionability | Todo has specific, completable title | Pass/Fail |
| Insight quality | Review insights reference actual activity data | Pass/Fail |
| Link confidence | Knowledge link has reason + confidence >0.6 | Pass/Fail |

## Performance

### Desktop App

| Metric | Target |
|--------|--------|
| Cold start | <3 seconds |
| Hot reload (dev) | <500ms |
| AI response (1.5B model) | <5 seconds |
| AI response (7B model) | <15 seconds |
| RAG query | <2 seconds |
| SQLite query | <50ms |

### Memory
- Idle: <200MB (including Ollama model if loaded)
- Active: <500MB

## Reliability Metrics

| Metric | Target |
|--------|--------|
| Crash rate | 0 critical bugs in production |
| Data loss | 0 (confirmation gate enforced) |
| AI invalid output rate | <5% (caught by JSON validator) |
| Migration success rate | 100% (forward-only, tested) |

## Testing Pyramid

```
        ┌──────┐
        │ E2E  │  ← daily-learning-flow
       ┌┴──────┴┐
       │  Integ  │  ← repositories + use-cases
      ┌┴─────────┴┐
      │   Unit     │  ← domain + AI + application + UI stores
     └─────────────┘
```

## Review Checklist
See `AGENTS.md` for coding conventions enforced during review.
