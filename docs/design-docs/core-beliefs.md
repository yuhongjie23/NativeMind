# Core Beliefs

These are the founding principles of NativeMind. They guide every design decision
and should be reconsidered rarely and deliberately.

## 1. Learning is Active, Not Passive

Reading is not learning. Watching is not learning. Learning happens when you
**retrieve, apply, connect, and reflect**. NativeMind structures these activities;
it does not replace them with AI-generated summaries.

**Implication**: AI output is always a draft. The user must engage with it
(edit, confirm, reject) for it to become knowledge.

## 2. Focus is Sacred

Deep work is the unit of real learning. Interruptions during focus are not
just annoying — they destroy the cognitive state that makes learning stick.

**Implication**: During active focus sessions, AI is silent. Notifications are
suppressed. The UI strips down to just the timer and current task. This is
enforced by `FocusModePolicy` at the application layer, not just UI hiding.

## 3. Data is a Long-Term Asset

Today's notes, links, and reviews are tomorrow's knowledge graph. The value
of NativeMind compounds over time as connections accumulate.

**Implication**: Data must be portable, structured, and locally owned. SQLite
is chosen because it's a single file the user can back up, move, or inspect.
Knowledge links are archived, not deleted, preserving the graph's integrity.

## 4. AI is a Tool, Not a Friend

The AI assistant (including the companion character) provides structure,
connections, and reflection prompts. It does not chat for engagement's sake.

**Implication**: The companion asks max 2 questions per day. It does not
generate small talk. Every interaction has a learning purpose.

## 5. Local-First by Default

Trust comes from ownership. If the data is on someone else's server, the user
doesn't truly own it. Network access is a capability to opt into, not a
dependency to opt out of.

**Implication**: The app is fully functional offline. External search requires
explicit per-query confirmation. No telemetry, no accounts, no sync unless
the user explicitly sets it up.

## 6. Write Once, Confirm Always

Every change to stored data must be intentional. "Undo" is better than "delete
and forget." The confirmation gate is not friction — it's the mechanism that
makes AI assistance trustworthy.

**Implication**: All writes go through `ConfirmationService`. All AI suggestions
are `ActionProposal` objects that require user confirmation. Knowledge links
archive rather than delete.

## 7. Small Models, Smart Routing

You don't need a 70B model to structure a todo list. Different tasks need
different levels of intelligence. Small, fast models for mechanical tasks;
larger models for reasoning and insight.

**Implication**: The model router (`ai/router/model-router.ts`) routes tasks
to appropriate model tiers. 1.5B for todo structuring; 7B for review generation
and knowledge linking; 14B optional for deep analysis.

## 8. Structured Over Free-Form

Free-form AI chat is a liability for data integrity. Structured output
(JSON Schema) ensures AI responses can be validated, stored, and queried.

**Implication**: All AI prompts have corresponding JSON schemas
(`ai/schemas/*.v1.json`). Invalid output is discarded, not silently ingested.
Prompts and schemas are versioned for auditability.
