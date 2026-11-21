# Remove Useless Code Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete every code comment that doesn't warn about something non-obvious; keep (shortened) warnings and all tool directives. Comments only, no behaviour change.

**Architecture:** Four commits, one per area. Each is checked by the full test/lint/typecheck/build run plus a comments-only checker that compares the parsed token stream of every changed file against `origin/main`.

**Tech Stack:** TypeScript (Express backend, React/Vite frontend), Vitest, ESLint, Playwright e2e, Firestore rules, GitHub Actions YAML.

**Spec:** the user's approved rule (2026-11-21, global CLAUDE.md "Code comments") and the task brief.

## Global Constraints

- Delete comments that explain what code does, restate names, narrate history/changes, or reference tasks/plans/PRs/reviews/specs/commits. This includes JSDoc that restates a signature, section dividers, commented-out code and test-description comments.
- Keep only: (a) warnings about non-obvious traps, shortened to the one line given in the keep-list; (b) tool directives (eslint-disable, `/// <reference`, and the like).
- Never edit code, reformat, or reflow. No leftover blank-line pileups, no empty JSDoc, and `// eslint-disable-next-line` stays directly above its line.
- Excluded, do not touch: `docs/`, `README.md`, `.claude/skills/**/SKILL.md`, lockfiles, `.firebase/*.cache` (generated), `frontend/public/*` (assets), `dist/`, `node_modules/`.
- YAML, Dockerfile and config files follow the same rule. Checked: only `.github/workflows/frontend.yml` and `firestore.rules` contain comments. The Dockerfile, ignore files, `.env.*`, JSON, CSS and HTML contain none.

## Inventory

TS/JS comments were found with the TypeScript parser, so `//` inside strings, globs and URLs doesn't count. The results were cross-checked with grep. Other files were checked with grep for `#`, `//`, `/*` and `<!--`. All 218 comment lines are listed by area below.

| Area (task) | Comment lines now | Kept after | Removed |
|---|---|---|---|
| `backend/src/providers/` (T1) | 112 | 15 | 97 |
| rest of `backend/src/` (T2) | 48 | 12 | 36 |
| `frontend/src/` (T3) | 46 | 4 | 42 |
| `firestore.rules`, `.github/workflows/` (T4) | 12 | 2 | 10 |
| **Total** | **218** | **33** (29 warnings + 4 directives) | **185** |

`e2e/`, `backend/eslint.config.mjs`, `frontend/eslint.config.js` and `frontend/vite.config.ts` have no comments.

## Keep-list

Replace each kept comment with exactly the text shown. "as-is" means leave it unchanged. Line numbers refer to `origin/main` (c228b7f). Delete every other comment in the area.

### Tool directives (keep unchanged)
- `backend/src/routes/conversations.tracing.test.ts:57` `// eslint-disable-next-line @typescript-eslint/no-unused-vars`
- `backend/src/routes/conversations.tracing.test.ts:84` same
- `backend/src/routes/conversations.tracing.test.ts:114` `// eslint-disable-next-line require-yield`
- `frontend/src/vite-env.d.ts:1` `/// <reference types="vite/client" />`

### T1 — `backend/src/providers/` (all in `GeminiProvider.ts` unless noted)
- `:35-36` → `// Missing from the SDK's ToolConfig type; required when mixing googleSearch with function calling.`
- `:63-65` → `// Not chunk.text(): the legacy SDK concatenates thought parts into the answer.`
- `:73-75` → `// visibleText() doesn't throw on these, so they must be checked or a blocked reply is persisted as complete.`
- `:78-80` → `// Truncation and repetition end with a notice, not an error, so the partial reply already streamed is kept.` (also covers `REPETITION_NOTICE`, so delete `:83-85`)
- `:147-152` → `// Returning isn't enough: the SDK keeps pumping the response (and Gemini keeps billing) until the request is aborted.`
- `:165-167` → `// Only append to a pass with visible text, or hasText skips the follow-up call that writes the reply.`
- `:181-183` → `// Thought tokens count against maxOutputTokens, so this needs far more headroom than the visible reply.`
- `:187` as-is: `// The SDK's Tool union doesn't include googleSearch`
- `:197-200` → `// One controller serves both passes: a loop always has visible text, so an aborted primary pass never reaches the follow-up.`
- `:204-206` → `// ChatSession strips thought_signature from its history, so raw parts are kept for the follow-up call.`
- `:259-262` → `// Not chat.sendMessageStream: manual history keeps thought_signature in the follow-up request.`
- `:268-270` → `// Only functionResponse parts: a text part here makes the thinking model write its reasoning as the reply.`
- `:295-298` → `// Unobserved, this rejects on abort and crashes the process; non-abort errors still surface via the stream below.`
- `:332-334` → `// Failures are swallowed: suggestions must never fail a reply that already streamed.`
- `repetitionGuard.ts:1-10` → `// Threshold is on repeated span length, not repeat count, so short legitimate repetition ("ha ha ha", markdown rules) passes.`

### T2 — rest of `backend/src/`
- `app.ts:16` as-is (dev CORS allows all origins on purpose)
- `config/firebase.ts:3-5` → `// Local dev has no metadata server, so verifyIdToken() fails with auth/invalid-credential without an explicit projectId.`
- `config/langfuse.ts:10-12` (drop `:7-9`) → `// NodeTracerProvider, not NodeSDK: NodeSDK adds gRPC/protobuf exporters and resource detectors that attach host metadata to every span.`
- `config/langfuse.ts:17-18` → `// register() also installs the AsyncLocalStorage context manager; without it spans don't nest.`
- `config/langfuse.ts:22-23` → `// Cloud Run throttles CPU after the response ends; flush while the request is still open.`
- `config/langfuse.ts:32-33` → `// thoughtsTokenCount exists at runtime but is missing from the legacy SDK's type.`
- `config/langfuse.ts:55-57` → `// Strings are pre-encoded too: the SDK JSON-encodes objects but passes strings raw, which breaks uniform parsing.`
- `index.ts:17-18` → `// Without this, open SSE streams keep close() from completing and the final Langfuse flush is skipped.`
- `services/firestore.ts:132-133` → `// Pick fields explicitly: spreading d.data() leaks stray Firestore fields to Gemini.`

### T3 — `frontend/src/` (all in `hooks/useChatStream.ts`)
- `:24-27` → `// Bumped when the user leaves the streamed conversation; the request keeps running so the backend still persists the reply.`
- `:29-31` → `// Ref so late callbacks (e.g. onDone) see the conversation on screen now, not the one at send time.`
- `:122-125` → `// Snapshot so a stale refetch can't overwrite state after a later navigation or send.`

### T4 — config
- `.github/workflows/frontend.yml:46` as-is (the API key in the workflow is public on purpose, not a leaked secret)
- `firestore.rules:3-13` → `// Deny all: clients never access Firestore directly, and the backend's Admin SDK bypasses these rules.`

## Verification (after every task)

Run from the worktree root. All of these must pass:

```bash
(cd backend && npm test && npm run lint && npx tsc --noEmit && npm run build)
(cd frontend && npm test && npm run lint && npx tsc --noEmit && npm run build)
node .superpowers/comments-only-check.cjs origin/main
```

Expected: backend 126 tests pass, frontend 62 tests pass, lint/tsc/build exit 0, checker prints `OK: N changed file(s), comments only`.

The checker (Appendix) fails if any of these happen: the parsed leaf-token stream of a changed TS/JS file differs (for YAML/rules files, the non-comment lines differ); a `+`/`-` diff line isn't a comment or blank line; a new run of 2+ blank lines appears; or an empty `/** */` is left behind. It was tested to catch an edited identifier, an edited template string, an added space, a deleted code line in `firestore.rules`, and a blank-line pileup, and to pass a comment-only edit.

Also check after each task: `grep -rn eslint-disable backend/src frontend/src` still shows 3 lines, and each one is directly above the line it targets.

Prettier is **not** a gate: on `origin/main` it already flags 5 files (`backend/src/tools/anthropicNews.test.ts`, `frontend/src/firebase.test.ts`, `frontend/src/pages/ChatPage.test.tsx`, `e2e/global-setup.ts`, …) and CI doesn't run it. Don't run `--write`.

---

### Task 1: `backend/src/providers/`

**Files:** Modify `GeminiProvider.ts`, `GeminiProvider.test.ts`, `GeminiProvider.tracing.test.ts`, `GeminiTitleGenerator.tracing.test.ts`, `repetitionGuard.ts`, `repetitionGuard.test.ts`

- [ ] **Step 1:** Delete every comment in these files except the T1 keep-list. Replace each kept comment with its keep-list text.
- [ ] **Step 2:** Run the Verification block. Expected: all pass.
- [ ] **Step 3:** Commit `chore(backend): remove non-warning comments from providers`

### Task 2: rest of `backend/src/`

**Files:** Modify `app.ts`, `index.ts`, `config/firebase.ts`, `config/langfuse.ts`, `models/api.ts`, `prompts/suggestions.ts`, `routes/conversations.ts`, `services/firestore.ts`, `tools/registry.ts`. Leave `routes/conversations.tracing.test.ts` unchanged (it has only directives).

- [ ] **Step 1:** Delete every comment except the T2 keep-list and the directives. Replace each kept comment with its keep-list text.
- [ ] **Step 2:** Run Verification. Expected: all pass.
- [ ] **Step 3:** Commit `chore(backend): remove non-warning comments`

### Task 3: `frontend/src/`

**Files:** Modify `hooks/useChatStream.ts`, `pages/ChatPage.test.tsx`, `components/MessageList.test.tsx`. Leave `vite-env.d.ts` unchanged.

- [ ] **Step 1:** Delete every comment except the T3 keep-list. Replace each kept comment with its keep-list text.
- [ ] **Step 2:** Run Verification. Expected: all pass.
- [ ] **Step 3:** Commit `chore(frontend): remove non-warning comments`

### Task 4: config files

**Files:** Modify `firestore.rules`. `.github/workflows/frontend.yml` stays unchanged.

- [ ] **Step 1:** Replace `firestore.rules:3-13` with the T4 line. Keep the blank line after `rules_version = '2';`.
- [ ] **Step 2:** Run Verification. Expected: all pass, and the rules diff is comment lines only.
- [ ] **Step 3:** Commit `chore: shorten firestore rules comment`

### Final: e2e + recount

- [ ] Run e2e once: `cd e2e && npm test`. It starts Firebase emulators and dev servers (frontend on 5174). If a port is in use, report it. Don't kill the process.
- [ ] Recount with the TypeScript-parser scan plus grep for YAML/rules. Expected: 33 comment lines remain, and they match the keep-list exactly.

## Review Focus

1. A removed comment was the only line between two blank lines, so a blank-line pileup is left behind. The checker catches this.
2. A shortened warning loses its key fact (e.g. "SDK keeps billing until aborted"). Compare each replacement against the original before committing.
3. An `eslint-disable-next-line` ends up separated from its target line. Lint would then fail with "unused directive" or a rule error.
4. A `//` inside a template literal (prompts in `backend/src/prompts/*.ts`) gets mistaken for a comment and edited. The checker's token compare catches this.
5. The keep-list is a judgement call. If the user wants it closer to "99% removed", the weakest candidates are `GeminiProvider.ts:187`, `:197-200`, `:165-167`, `langfuse.ts:55-57` and `useChatStream.ts:29-31`.

## Appendix: `.superpowers/comments-only-check.cjs`

`.superpowers/` is gitignored. Create this file there, and run it from the worktree root after `npm ci` in `backend/`.

```js
const { execFileSync } = require('child_process')
const fs = require('fs')
const ts = require(require.resolve('typescript', { paths: [process.cwd() + '/backend'] }))
const base = process.argv[2] || 'origin/main'
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 26 })
const files = git('diff', '--name-only', base, '--', '.', ':(exclude)docs').split('\n').filter(Boolean)
const tokens = (text, f) => {
  const kind = /\.tsx$/.test(f) ? ts.ScriptKind.TSX : /\.(c|m)?jsx?$/.test(f) ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kind)
  const out = []
  const walk = (n) => {
    const kids = n.getChildren(sf)
    if (kids.length === 0) out.push(n.kind + ':' + n.getText(sf))
    else kids.forEach(walk)
  }
  walk(sf)
  return out.join('\n')
}
const hashStrip = (t) => t.split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l) && l.trim() !== '').join('\n')
let bad = 0
for (const l of git('diff', '-U0', base, '--', '.', ':(exclude)docs').split('\n')) {
  if (!/^[+-]/.test(l) || /^(\+\+\+|---) /.test(l)) continue
  const body = l.slice(1).trim()
  if (body !== '' && !/^(\/\/|#|\/\*|\*)/.test(body)) { bad++; console.log(`FAIL non-comment diff line: ${l}`) }
}
for (const f of files) {
  const before = git('show', `${base}:${f}`)
  const after = fs.readFileSync(f, 'utf8')
  const same = /\.(c|m)?[jt]sx?$/.test(f) ? tokens(before, f) === tokens(after, f) : hashStrip(before) === hashStrip(after)
  const pileup = /\n[ \t]*\n[ \t]*\n/.test(after) && !/\n[ \t]*\n[ \t]*\n/.test(before)
  const emptyDoc = /\/\*\*\s*\*\//.test(after)
  if (!same || pileup || emptyDoc) { bad++; console.log(`FAIL ${f}${same ? '' : ' code-changed'}${pileup ? ' blank-pileup' : ''}${emptyDoc ? ' empty-jsdoc' : ''}`) }
}
console.log(bad ? `${bad} problem(s)` : `OK: ${files.length} changed file(s), comments only`)
process.exit(bad ? 1 : 0)
```
