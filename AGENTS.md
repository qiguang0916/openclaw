# OpenClaw Development Invariants (Optimized)

- **Context**: TypeScript (ESM), Node 22+. American English. File refs: repo-root relative (`src/cli/index.ts:80`).
- **Boundaries**: Core is extension-agnostic. Extensions ONLY use `openclaw/plugin-sdk/*`.

## 🗺️ Project Map & Entry Points

| Context         | Primary Files / Boundaries                                                                   |
| :-------------- | :------------------------------------------------------------------------------------------- |
| **CLI / Core**  | `src/cli/`, `src/commands/`, `src/infra/`, `src/media/`                                      |
| **Plugin SDK**  | `src/plugin-sdk/` (**Boundary**: `plugin-entry.ts`, `core.ts`, `provider-entry.ts`)          |
| **Channels**    | `src/channels/` (Telegram, Discord, Slack, Signal, iMessage, WhatsApp Web)                   |
| **Protocol**    | `src/gateway/protocol/` (`schema.ts`, `index.ts`)                                            |
| **Ext/Plugins** | `plugins/` (Matrix, Zalo, Voice, etc.); `extensions/` (Legacy/internal label)                |
| **Docs**        | `docs/` (Mintlify). Hosting: `https://docs.openclaw.ai`. No em-dashes/apostrophes in titles. |

## 🛠️ Critical Rules & Nomenclature

- **Naming**: Use **"plugin"** in UI/Docs/Logs. Keep **"extension"** for internal package layout/labels.
- **Security**: Respect `CODEOWNERS`. No real credentials/keys. `~/.openclaw` stores local state.
- **Architecture**: No hardcoded extension IDs in core. Use registries/manifests/capabilities.
- **Imports**: NEVER mix static + dynamic imports for the same module. Use `*.runtime.ts` for lazy seams.
- **Extensions**: Do NOT self-import via `openclaw/plugin-sdk/<id>`; use local `./api.ts`.
- **Typing**: Use `Zod` at boundaries. Prefer discriminated unions & `Result<T, E>`. No string-branching on errors.
- **Cache**: Request assembly MUST be deterministic (sort maps/lists). Prefix byte stability is critical.

## 🚀 Workflows & Commands

- **Git**: Use `scripts/committer`. NEVER use merge commits; rebase on `origin/main`. No `stash`/`worktree`.
- **Verification**: `pnpm install`, `pnpm check` (oxfmt/oxlint), `pnpm build` (on build-impacting edits), `pnpm tsgo`.
- **i18n**: Source is `en.ts` / glossary. Sync via `pnpm ui:i18n:sync` or `pnpm docs:check-i18n-glossary`.
- **Versioning**: Bump in `package.json`, `build.gradle.kts`, `Info.plist`, `updating.md`. `appcast.xml` (Sparkle).
- **PRs**: Append changes to active version block in `CHANGELOG.md`. Max 1 contributor mention per line.

## 🧪 Testing & Performance

- **Framework**: Vitest (V8 coverage >70%). `pnpm test <path>` for scope. Max workers 16.
- **Execution**: Clean up timers, env, mocks, sockets for `--isolate=false`.
- **Optimization**: Avoid `vi.resetModules()` + `import()` in hot loops. Use lazy `beforeAll` or `*.runtime.ts`.
- **Live**: `OPENCLAW_LIVE_TEST=1 pnpm test:live`. Default is quiet.

## 🍎 Platform Specifics

- **macOS**: "makeup" = Mac App. Restart via app or `scripts/restart-mac.sh`. Logs: `./scripts/clawlog.sh` (sudo).
- **Mobile**: `ws://` OK for private LAN (RFC 1918). Team ID via `security find-identity -p codesigning -v`.
- **UI/TTY**: Use `osc-progress` (`src/cli/progress.ts`), `palette.ts`, and `table.ts`. No hand-rolled spinners.
- **Voice**: Template `openclaw-mac agent --message "${text}" --thinking low`. No extra quotes.
