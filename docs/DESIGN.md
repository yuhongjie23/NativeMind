# DESIGN.md — Visual & Interaction Design

## Design System

### Tech Stack
- **Framework**: Tailwind CSS 3.4 with custom theme
- **Components**: shadcn/ui style (copied source, not library)
- **Charts**: Recharts
- **Graph visualization**: D3.js (d3-force for knowledge graph)
- **Animations**: Lottie (companion character)
- **Editor**: CodeMirror 6 (note editing)

### Color Palette

| Token | Usage |
|-------|-------|
| `primary` | Main actions, active states, focus timer ring |
| `secondary` | Secondary buttons, tags, chips |
| `muted` | Backgrounds, disabled states, placeholder text |
| `accent` | Companion interactions, celebration states |
| `destructive` | Delete, abort, cancel actions |

### Typography
- Font stack: system UI font stack (native platform fonts)
- Headings: Tailwind's default scale (`text-2xl`, `text-xl`, etc.)
- Body: `text-base` (16px), `text-sm` for secondary info
- Monospace: CodeMirror editor, code snippets in notes

### Layout
- **App Shell**: Sidebar navigation (left) + content area
- **Sidebar**: Icon-based nav with tooltips, collapses on narrow screens
- **Main content**: Max-width container, centered, scrollable
- **Focus mode**: Full-screen overlay, minimal UI, only timer visible

### Component Patterns

#### TodoCard
- Checkbox + title + priority badge + estimated time
- Expand for description and linked notes
- Drag to reorder within day

#### FocusTimer
- Circular progress ring (SVG)
- Current task display
- Controls: Start, Pause, Complete, Abort
- Background audio selector

#### KnowledgeGraph
- D3 force-directed graph
- Nodes = Notes/Todos/Concepts
- Edges = Knowledge links (colored by relation type)
- Click node → detail panel
- Zoom and pan

#### CompanionWidget
- Lottie animation container
- Dialogue bubble (positioned relative to animation)
- Interaction buttons (respond to question, dismiss)
- Presence states: idle, active, speaking, celebrating

#### ConfirmationModal
- Title: "AI suggests..."
- Action description with metadata (what will change)
- "Confirm" / "Skip" / "Edit" buttons
- Domain-specific preview (e.g., show linked notes for knowledge link)

### Interaction Design Principles

1. **Minimal during focus**: During active focus sessions, all non-essential UI elements are hidden. Only the timer and current task remain visible.

2. **AI is quiet by default**: The AI/companion only surfaces when it has a concrete suggestion (knowledge link, review draft, todo structure). It does not proactively chat.

3. **Confirmation before mutation**: Every AI-generated write action shows a confirmation dialog explaining what will change and why.

4. **Undo where possible**: Prefer archive/restore over hard delete. Knowledge links archive; todos cancel rather than delete.

5. **Progressive disclosure**: Complex features (RAG settings, model config) are behind settings panels, not in the main flow.

### Responsive Breakpoints

| Breakpoint | Target |
|------------|--------|
| `sm` (640px) | Narrow sidebar → icon-only |
| `md` (768px) | Full sidebar, single-column content |
| `lg` (1024px) | Two-column layouts (e.g., knowledge graph + detail panel) |
| `xl` (1280px) | Maximum content width |

### Accessibility
- All interactive elements are keyboard-navigable
- Focus ring visible (Tailwind `ring` utilities)
- ARIA labels on icon buttons
- Timer has audio cues (start, complete) via `public/audio/cue/`
- Color is never the only differentiator (icons + text + color)
