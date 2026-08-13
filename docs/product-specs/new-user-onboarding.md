# New User Onboarding

> Status: Draft | Version: 0.1

## Goal
Get a new user from "just installed" to "first completed focus session + reviewed" in under 5 minutes.

## Onboarding Flow

### Step 1: Welcome (1 screen)
- App name + one-line value prop: "你的本地 AI 学习伙伴"
- "Get Started" button
- No account creation, no sign-up

### Step 2: Meet the Companion (1 screen)
- Companion character introduction (Gugu-gaga)
- Brief: "I'll help you stay focused and connect your ideas"
- User names their companion (optional, default: "Gugu")

### Step 3: First Goal (1 screen)
- Prompt: "What are you learning right now?"
- Free text input
- AI suggests 2-3 todos based on input (template mode if offline)
- User confirms or edits

### Step 4: First Focus (guided)
- "Let's try a focus session — 25 minutes"
- Timer UI explained (2-3 tooltips)
- Start first Pomodoro
- Companion says "I'll be quiet now, good luck!"

### Step 5: First Review (after focus)
- AI generates a mini-review based on the session
- User sees: "You focused for 25min on [task]. Want to add a note?"
- Quick note input

### Step 6: Done
- "You're all set! Here's your Today page."
- Optional: import existing notes, explore settings

## Design Principles for Onboarding
- No account creation — data is local, no email needed
- Show, don't tell — each step is interactive, not a carousel
- AI presence is introduced gradually — first as todo helper, then as reviewer
- Skip everything is allowed — user can jump straight to the app

## Open Questions
- Should we require the user to complete one focus session, or can they skip?
- Do we need language selection in onboarding? (Currently Chinese-first)
- Should onboarding differ between web preview and desktop?
