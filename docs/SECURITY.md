# SECURITY.md — Security & Privacy

## Core Principle

NativeMind is **local-first**. User data never leaves the device by default.
All network access is opt-in and explicitly confirmed.

## Data Location

All user data is stored locally:
- **SQLite database**: App data directory (OS-specific)
- **Imported files**: Copied to app data directory
- **Vector embeddings**: Stored in sqlite-vec, same database
- **Settings**: Same SQLite database, `settings` table

### OS-specific paths
| Platform | Data directory |
|----------|---------------|
| Windows | `%APPDATA%\com.nativemind.app\` |
| macOS | `~/Library/Application Support/com.nativemind.app/` |
| Linux | `~/.local/share/com.nativemind.app/` |

## Network Access

### When the app connects to the network:

| Scenario | Endpoint | Trigger |
|----------|----------|---------|
| Ollama API | `http://localhost:11434` | AI features (local only) |
| External search | User-configured | Opt-in, per-query confirmation |

### When the app does NOT connect:
- All other operations are fully offline
- No telemetry, no analytics, no crash reporting
- No auto-update checking (manual updates only)

## Privacy Protections

### Privacy Policy (`src/application/policies/privacy-policy.ts`)
- External search is blocked by default
- User must explicitly enable and confirm each external query
- Search queries are never logged or cached externally

### Focus Mode Privacy
- During active focus sessions, AI is silenced (unless explicitly summoned)
- Companion interactions are minimized

## Write Confirmation

Every data mutation goes through the confirmation gate:
1. AI or user action produces an `ActionProposal`
2. `ConfirmationService` evaluates the proposal
3. User must explicitly confirm before write executes
4. All confirmed writes are audit-logged

## Data Integrity

### Content Deduplication
- Imported notes are hashed (`contentHash` field)
- Same content imported twice → detected and skipped

### Archive, Not Delete
- Knowledge links use `archivedAt` instead of physical deletion
- Prevents AI from re-suggesting previously rejected links
- Restore is possible via `restore()` method

## Desktop App Security (Tauri)

### CSP (Content Security Policy)
- Configured in `tauri.conf.json`
- Currently permissive (`null`) for development; must be tightened before release

### Tauri Capabilities
- `capabilities/default.json` defines allowed IPC commands
- Principle of least privilege: only expose commands that are needed

### Rust-side Security
- SQLite uses parameterized queries (rusqlite `?` placeholders) — no SQL injection
- File path canonicalization before access (`canonicalize()`)
- No `eval()` or dynamic code execution

## Recommendations for Production

- [ ] Tighten CSP in `tauri.conf.json`
- [ ] Review Tauri capabilities — remove unused permissions
- [ ] Add database encryption (SQLCipher or similar)
- [ ] Implement secure credential storage for any future sync features
- [ ] Add integrity check for imported files (validate before processing)
- [ ] Consider sandboxing the Tauri webview
