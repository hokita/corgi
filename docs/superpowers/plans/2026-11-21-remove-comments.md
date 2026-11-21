# Remove All Code Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete every code comment, then remove every lint/type ignore directive and fix the code underneath so lint and typecheck pass without them. Only build-needed directives stay.

**Architecture:** A deterministic strip script (Appendix B) removes the comments in four comments-only commits, one per area. Task 5 is a separate real-code commit that removes the 3 eslint-disable directives. After each commit, the full test/lint/typecheck/build run must pass, and a comments-only checker (Appendix A) compares each changed file's parsed code tokens against `origin/main`.

**Tech Stack:** TypeScript (Express backend, React/Vite frontend), Vitest, ESLint, Playwright e2e, Firestore rules, GitHub Actions YAML.

**Spec:** the user's rule (global CLAUDE.md "Code comments": write no code comments; only tool directives stay). It was approved on 2026-11-21 with the strictest cut, which replaced an earlier "keep warnings" version of this plan.

## Global Constraints

- Delete every comment, including warnings, JSDoc, test descriptions, history notes and the rules-file header.
- Comment tasks (T1–T4) delete every comment except tool directives. The strip script also leaves `eslint-disable*`/`@ts-*` for Task 5 to remove. If deleting a comment breaks a tool (e.g. eslint `no-empty`), keep the minimum needed and list it in the PR. The dry run found no such case.
- Never ignore lint or type errors. Task 5 removes every lint/type ignore (`eslint-disable*`, `biome-ignore`, `@ts-ignore`, `@ts-expect-error`, `//nolint`, `prettier-ignore`) and fixes the code properly. Only build-needed directives stay (`/// <reference`, `//go:build`, `//go:embed`, shebangs). A `git grep` on `origin/main` finds only the 3 eslint-disable lines below.
- Don't add code, tests or new comments to make up for a removed warning. Traps that lost their comment are listed below for the PR body.
- Never edit code, reformat, or reflow. No blank-line pileups, no blank line left right after `{`/`(`/`[`, and no empty JSDoc.
- Excluded, do not touch: `docs/`, `README.md`, `.claude/skills/**/SKILL.md`, lockfiles, `.firebase/*.cache` (generated), `frontend/public/*` (assets), `dist/`, `node_modules/`. The Dockerfile, ignore files, `.env.*`, JSON, CSS, HTML, `e2e/` and the eslint/vite configs contain no comments.

## Inventory and counts

TS/JS comments were found with the TypeScript parser and cross-checked with grep. YAML and rules files were checked with grep.

| Area (task) | Comment lines now | Kept | Removed |
|---|---|---|---|
| `backend/src/providers/` (T1) | 112 | 0 | 112 |
| rest of `backend/src/` (T2) | 48 | 3 (eslint-disable; removed in T5) | 45 |
| `frontend/src/` (T3) | 46 | 1 (`/// <reference>`) | 45 |
| `firestore.rules`, `.github/workflows/frontend.yml` (T4) | 12 | 0 | 12 |
| T5 (fix commit) | 3 | 0 | 3 |
| **Total** | **218** | **1** (`/// <reference>`) | **217** |

Directives:
- removed in Task 5: `backend/src/routes/conversations.tracing.test.ts:57`, `:84` `// eslint-disable-next-line @typescript-eslint/no-unused-vars`
- `backend/src/routes/conversations.tracing.test.ts:114` `// eslint-disable-next-line require-yield`
- kept (build-needed): `frontend/src/vite-env.d.ts:1` `/// <reference types="vite/client" />`

A dry run over all areas on `origin/main` passed: the checker printed OK for 20 files, backend 126 tests and frontend 62 tests passed, and lint, tsc and the blank-line scan were clean. Both test runs print about 30 stderr stack traces, and the same traces appear on `origin/main` (they come from the tests' expected logged errors).

## Traps that lost their comment (for the PR body)

Line numbers refer to `origin/main`.
- `backend/src/app.ts:16`: CORS allows all origins when `FRONTEND_URL` is unset (dev).
- `backend/src/config/firebase.ts:3`: local dev needs an explicit `projectId`, or `verifyIdToken()` fails with auth/invalid-credential.
- `backend/src/config/langfuse.ts:10`: uses NodeTracerProvider, not NodeSDK, to avoid the exporter bloat and resource detectors that attach host metadata to every span.
- `backend/src/config/langfuse.ts:17`: `register()` also installs the AsyncLocalStorage context manager that span nesting needs.
- `backend/src/config/langfuse.ts:22`: Cloud Run throttles CPU after the response ends, so spans must be flushed before it ends.
- `backend/src/config/langfuse.ts:32`: `thoughtsTokenCount` exists at runtime but is missing from the legacy SDK's type.
- `backend/src/config/langfuse.ts:55`: `toTraceValue` JSON-encodes strings too, because the SDK passes strings raw.
- `backend/src/index.ts:17`: `closeAllConnections()` is needed, or open SSE streams block `close()` and the final Langfuse flush is skipped.
- `backend/src/services/firestore.ts:132`: fields are picked explicitly, because spreading `d.data()` would leak stray Firestore fields to Gemini.
- `backend/src/providers/GeminiProvider.ts:35`, `:187`, `:192`: `as unknown as` casts work around SDK types missing `includeServerSideToolInvocations` and `googleSearch`. The config is required when mixing googleSearch with function calling.
- `GeminiProvider.ts:63`: `chunk.text()` can't be used because the legacy SDK mixes thought parts into the answer.
- `GeminiProvider.ts:73`: `visibleText()` doesn't throw on SAFETY/RECITATION/LANGUAGE, so without the explicit check a blocked reply is saved as complete.
- `GeminiProvider.ts:78`, `:83`: truncation and repetition end with a notice, not an error, on purpose, so the partial reply is kept.
- `GeminiProvider.ts:147`: returning on a repetition loop doesn't stop billing; the SDK keeps pumping the response until the request is aborted.
- `GeminiProvider.ts:165`: the notice may only be appended to a pass with visible text, or `hasText` skips the follow-up call.
- `GeminiProvider.ts:181`: `maxOutputTokens` is 15000 because thought tokens count against it.
- `GeminiProvider.ts:197`: one AbortController serves both passes, which is safe only because an aborted primary pass never reaches the follow-up.
- `GeminiProvider.ts:204`, `:259`: ChatSession strips `thought_signature`, so raw parts are captured and the follow-up uses `generateContentStream` with manual history.
- `GeminiProvider.ts:268`: the follow-up turn must contain only functionResponse parts, or the thinking model writes its reasoning as the reply.
- `GeminiProvider.ts:295`: `followUp.response?.catch(() => {})` prevents an unhandled rejection on abort that would crash the process.
- `GeminiProvider.ts:332`: suggestion failures are swallowed on purpose, so they never fail a reply that already streamed.
- `backend/src/providers/repetitionGuard.ts:1`, `:28`: the threshold is on repeated span length, not repeat count, and the check works from the end so a loop that stops mid-copy is still caught.
- `frontend/src/hooks/useChatStream.ts:24`: `generation` is bumped when the user leaves the conversation, while the request keeps running so the backend still saves the reply.
- `useChatStream.ts:29`: `activeIdRef` lets late callbacks see the conversation on screen now (stale closure).
- `useChatStream.ts:83`, `:107`, `:117`: `onMeta` and `onDone` update the sidebar even when the stream is no longer current, and refetch when the user has returned to the conversation.
- `useChatStream.ts:122`: the generation snapshot stops a stale refetch from overwriting state after a later navigation or send.
- `firestore.rules:3`: deny-all is safe because the client never touches Firestore and the backend's Admin SDK bypasses rules.
- `.github/workflows/frontend.yml:46`: the Firebase web API key in the workflow is public on purpose and isn't a leaked secret.

## Verification (after every task)

Run from the worktree root. All of these must pass:

```bash
(cd backend && npm test && npm run lint && npx tsc --noEmit && npm run build)
(cd frontend && npm test && npm run lint && npx tsc --noEmit && npm run build)
node .superpowers/comments-only-check.cjs origin/main
```

Expected: backend 126 tests pass, frontend 62 tests pass, lint/tsc/build exit 0, and the checker prints `OK: N changed file(s), comments only`. Then scan the changed files for a blank line right after an opener or two blank lines in a row; expect no output:

```bash
for f in $(git diff --name-only origin/main -- . ':(exclude)docs'); do awk -v F=$f 'prev ~ /[{(\[]$/ && $0 ~ /^[ \t]*$/ {print F":"NR": blank after opener"} $0 ~ /^[ \t]*$/ && b {print F":"NR": double blank"} {b=($0 ~ /^[ \t]*$/); prev=$0}' $f; done
```

The checker fails on: a changed TS/JS leaf-token stream (JSDoc ignored), or changed non-comment lines in YAML/rules files; a `+`/`-` diff line that is neither a comment, a blank line, nor a code line with only its trailing comment removed; a new double blank line; or an empty `/** */`. It was tested to catch an edited identifier, an edited template string, an added space (both on a plain line and on a trailing-comment line), a deleted code line in `firestore.rules`, and a blank-line pileup.

Prettier is not a gate. On `origin/main` it already flags 5 files and CI doesn't run it. Don't run `--write`.

The scripts live in the gitignored `.superpowers/` directory. If they're missing, recreate them from the appendices.

---

### Task 1: `backend/src/providers/`

**Files:** every tracked file under `backend/src/providers/`.

- [ ] **Step 1:** `node .superpowers/strip-comments.cjs $(git ls-files 'backend/src/providers/*')`
- [ ] **Step 2:** Run Verification. Expected: all pass, and no comments remain in `backend/src/providers/`.
- [ ] **Step 3:** Commit `chore(backend): remove comments from providers`, including this plan file in the same commit.

### Task 2: rest of `backend/src/`

**Files:** tracked files under `backend/src/` outside `providers/`.

- [ ] **Step 1:** `node .superpowers/strip-comments.cjs $(git ls-files 'backend/src/*' | grep -v '^backend/src/providers/')`
- [ ] **Step 2:** Run Verification. Expected: all pass. The only comments left in the area are the 3 eslint-disable lines in `routes/conversations.tracing.test.ts`, each still directly above its target line.
- [ ] **Step 3:** Commit `chore(backend): remove comments`

### Task 3: `frontend/src/`

- [ ] **Step 1:** `node .superpowers/strip-comments.cjs $(git ls-files 'frontend/src/*')`
- [ ] **Step 2:** Run Verification. Expected: all pass. The only comment left is `vite-env.d.ts:1`. The 3 trailing `// simulates…` comments in `pages/ChatPage.test.tsx` are removed together with the space before them.
- [ ] **Step 3:** Commit `chore(frontend): remove comments`

### Task 4: config files

- [ ] **Step 1:** `node .superpowers/strip-comments.cjs firestore.rules .github/workflows/frontend.yml`
- [ ] **Step 2:** Run Verification. Expected: all pass. `firestore.rules` starts with `rules_version = '2';`, then one blank line, then `service cloud.firestore {`. `frontend.yml` loses only line 46.
- [ ] **Step 3:** Commit `chore: remove comments from firestore rules and workflow`

### Task 5: remove the eslint-disable directives (real code change, test file only)

**Files:** Modify `backend/src/routes/conversations.tracing.test.ts` (origin/main lines 10, 57-60, 83-86, 113-117).

The comments-only checker doesn't apply to this commit. The full suite, lint and tsc must pass.

- [ ] **Step 1 (red for the rewritten mock):** Show the error test fails when the stream mock doesn't fail. Temporarily make the `'marks the root span as ERROR…'` mock return `defaultStream()`, run `cd backend && npx vitest run src/routes/conversations.tracing.test.ts`, expect that test to FAIL, then revert the temporary edit.
- [ ] **Step 2:** In the `mockAI` and `beforeEach` mocks, drop the unused params and the disable lines: `vi.fn().mockImplementation(() => defaultStream())` and `.mockImplementation(() => defaultStream())`. Remove `FunctionExecutor` from the line-10 import once it's unused.
- [ ] **Step 3:** Replace the yield-less generator in the error test with a plain `AsyncIterable<StreamItem>` whose iterator's `next()` returns `Promise.reject(new Error('stream exploded'))`, and drop the `require-yield` disable. Import `StreamItem` if needed. Same behaviour: the first `next()` rejects.
- [ ] **Step 4:** Run `cd backend && npx vitest run src/routes/conversations.tracing.test.ts`. Expected: PASS, including the ERROR test. Then run Verification minus the checker. Expected: 126 backend tests, lint clean, and `git grep -nE 'eslint-disable|@ts-ignore|@ts-expect-error|biome-ignore|nolint|prettier-ignore' -- ':!docs' ':!*lock*'` prints nothing.
- [ ] **Step 5:** Commit `test(backend): drop eslint-disable directives from tracing test`

### Final: e2e + recount

- [ ] Run e2e once: `cd e2e && npm test`. It starts Firebase emulators and dev servers (frontend on 5174). If a port is in use, report it. Don't kill the process.
- [ ] Recount. Expected: only `frontend/src/vite-env.d.ts:1` remains.

## Review Focus

1. The strip script leaves a blank line right after an opener, or a double blank line. The awk scan and the checker catch these.
2. A `//` inside a string or template literal (prompts in `backend/src/prompts/*.ts`, URLs) is treated as a comment. The strip script uses the TypeScript parser, so this shouldn't happen, and the checker's token compare catches it if it does.
3. A trailing comment is removed but its code changes. The checker only accepts a removed trailing comment when the remaining code line is otherwise unchanged.
4. Task 5's rewritten error mock stops actually failing the stream, so the ERROR test passes vacuously. Step 1's red run guards against this.
5. Something that isn't a comment, such as `#` in YAML values or `//` in a rules string, is removed in a non-code file. The strip script only removes lines whose first non-space characters are `#` or `//`, and the checker compares the remaining lines.

## Appendix A: `.superpowers/comments-only-check.cjs`

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
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return
    const kids = n.getChildren(sf)
    if (kids.length === 0) out.push(n.kind + ':' + n.getText(sf))
    else kids.forEach(walk)
  }
  walk(sf)
  return out.join('\n')
}
const hashStrip = (t) => t.split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l) && l.trim() !== '').join('\n')
let bad = 0
const isComment = (b) => b === '' || /^(\/\/|#|\/\*|\*)/.test(b)
const hunks = git('diff', '-U0', base, '--', '.', ':(exclude)docs').split(/\n(?=@@ )/)
for (const h of hunks) {
  const ls = h.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
  const minus = ls.filter((l) => l[0] === '-').map((l) => l.slice(1))
  for (const l of ls) {
    const body = l.slice(1).trim()
    if (isComment(body)) continue
    if (l[0] === '+' && minus.some((m) => m.replace(/\s*\/\/[^'"`]*$/, '') === l.slice(1))) continue
    if (l[0] === '-' && /\/\/[^'"`]*$/.test(l) && ls.some((p) => p[0] === '+' && l.slice(1).replace(/\s*\/\/[^'"`]*$/, '') === p.slice(1))) continue
    bad++; console.log(`FAIL non-comment diff line: ${l}`)
  }
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

## Appendix B: `.superpowers/strip-comments.cjs`

```js
const fs = require('fs')
const ts = require(require.resolve('typescript', { paths: [process.cwd() + '/backend'] }))
const DIRECTIVE = /^(\/\/\/\s*<reference|\/[/*]\s*(eslint-|@ts-|biome-ignore|prettier-ignore|c8 ignore|istanbul ignore|#region|#endregion))/
const collect = (f, text) => {
  const kind = /\.tsx$/.test(f) ? ts.ScriptKind.TSX : /\.(c|m)?jsx?$/.test(f) ? ts.ScriptKind.JSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kind)
  const seen = new Map()
  const visit = (pos) => {
    for (const fn of [ts.getLeadingCommentRanges, ts.getTrailingCommentRanges])
      for (const r of fn(text, pos) || []) seen.set(r.pos, r)
  }
  const walk = (n) => { visit(n.getFullStart()); visit(n.getEnd()); n.getChildren(sf).forEach(walk) }
  walk(sf)
  return [...seen.values()].filter((r) => !DIRECTIVE.test(text.slice(r.pos, r.end))).sort((a, b) => b.pos - a.pos)
}
const lineComment = (l) => /^\s*(\/\/|#)/.test(l) && !DIRECTIVE.test(l.trim())
for (const f of process.argv.slice(2)) {
  let text = fs.readFileSync(f, 'utf8')
  const isCode = /\.(c|m)?[jt]sx?$/.test(f)
  const removedAt = new Set()
  let lines
  if (isCode) {
    for (const r of collect(f, text)) {
      const ls = text.lastIndexOf('\n', r.pos - 1) + 1
      let le = text.indexOf('\n', r.end); if (le === -1) le = text.length
      const before = text.slice(ls, r.pos), after = text.slice(r.end, le)
      if (before.trim() === '' && after.trim() === '') {
        text = text.slice(0, ls) + '\u0000' + text.slice(le)
      } else {
        const start = r.pos - (before.length - before.trimEnd().length)
        text = text.slice(0, start) + text.slice(r.end)
      }
    }
    lines = text.split('\n')
  } else {
    lines = text.split('\n').map((l) => (lineComment(l) ? '\u0000' : l))
  }
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '\u0000') { out.push(lines[i]); continue }
    let j = i; while (j + 1 < lines.length && lines[j + 1] === '\u0000') j++
    const prev = out.length ? out[out.length - 1] : null
    const next = j + 1 < lines.length ? lines[j + 1] : null
    const prevBlankish = prev === null || prev.trim() === '' || /[{([]\s*$/.test(prev)
    if (next !== null && next.trim() === '' && prevBlankish) j++
    i = j
  }
  fs.writeFileSync(f, out.join('\n'))
}
```
