# PRODUCT_SENSE.md — Product Principles & UX Philosophy

## Product Identity

NativeMind is **not** an AI chatbot. It's a learning rhythm tool where AI plays a supporting role.

## Core Beliefs
See `docs/design-docs/core-beliefs.md` for the full manifesto.

## The Four Pillars

1. **Clarify** — Turn vague "I should learn X" into concrete, actionable todos
2. **Record** — Capture focus sessions, notes, and progress passively
3. **Connect** — AI finds links between new and old knowledge
4. **Review** — Structured daily/weekly reflection, not just more reading

## UX Philosophy

### AI is Quiet by Default
- No proactive chat during focus sessions
- AI only surfaces with concrete, actionable suggestions
- Companion asks max 2 questions per day (configurable)

### User Controls the Pen
- All AI output is **draft** until confirmed
- Every write action shows a confirmation dialog
- "Skip" and "Edit" are first-class actions alongside "Confirm"

### Local-First Trust
- No account, no login, no cloud
- Data is a single SQLite file the user owns
- External search is opt-in, per-query

### Learning, Not Consuming
- RAG connects notes, doesn't just answer questions
- Socratic mode asks the user to think, not just receive answers
- Reviews are generated from actual activity data, not generic templates

## Anti-Patterns We Avoid

| Anti-Pattern | Why |
|---|---|
| Chat as primary UI | Encourages passive consumption, not active learning |
| Auto-saving AI output | Bypasses the confirmation gate, erodes trust |
| Notification spam | Breaks focus, the core value proposition |
| Cloud dependency | Violates local-first trust, adds friction |
| Gamification | Extrinsic motivation crowds out intrinsic learning motivation |
| Infinite scroll feeds | Encourages browsing over doing |

## Target User
- Self-directed learners
- People building deep understanding in a domain
- Users who value privacy and data ownership
- Not: casual Duolingo-style learners, social learners
