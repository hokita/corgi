# corgi audit checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** corgi can't merge a PR with a high/critical vulnerability in prod deps or the backend image, and a nightly run on `main` reports dev deps, the deployed Cloud Run image, its Node version and unpinned Actions.

**Architecture:** Two fix PRs bring today's prod and dev findings to zero high+. Then one gates PR adds jobs to `ci.yml`, a new `audit-nightly.yml`, `dependabot.yml`, SHA/digest pins and two small Node scripts (tested with `node --test`). GitHub settings are switched on by the orchestrator with `gh api` around those PRs.

**Tech Stack:** npm audit, Trivy 0.76.2 (official image by digest), Node 24.22.3 `node:test`, GitHub Actions, gcloud (WIF, existing secrets).

**Spec:** `/Users/hokita/ghq/github.com/hokita/orch/docs/superpowers/specs/2026-11-22-audit-checks-design.md` (corgi rows of §5, §6, §7, §8, §9). Survey: `/tmp/audit-survey/REPORT.md` § corgi (the `corgiRT.md` file named in the task doesn't exist).

## Global Constraints

- High+ = high or critical. No `|| true`, `continue-on-error`, `--ignore-unfixed`, `--audit-level` tricks, or dropped dirs.
- No code comments, no lint/type ignores, SHA pins carry no `# vX` comment.
- No exception file unless the user approves an entry; corgi currently needs none (see Findings).
- No new secrets or keys: nightly uses `WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT` like the deploy workflows.
- No new identifiers in committed files: the image ref comes from `gcloud run services describe corgi-backend --region asia-northeast1` at run time.
- Trivy: `aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb` (released 2026-11-05, after GHSA-69fq-xp46-6x23, which affects only 0.69.4). Never `trivy-action`/`setup-trivy`.
- Node pin stays 24.22.3. `FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`.
- Nightly cron: `10 18 * * *` (03:10 JST) plus `workflow_dispatch`; `permissions: contents: read, id-token: write`.
- Merging to main deploys: `frontend/**` → Hosting, `backend/**` → Cloud Run, `frontend.yml` / `firestore-rules.yml` edits also trigger their own deploys. Each merge's deploy is watched.
- Never touch `~/ghq/github.com/hokita/corgi`. Work only in worktrees from `origin/main`.
- e2e uses ports 5174, 8090, 8081, 9099. If another worker holds them, report the pid; don't kill it.

## Findings (2026-11-22, `npm audit --package-lock-only` on origin/main 653b09b)

| dir | all (crit/high/mod) | prod high+ |
|---|---|---|
| backend | 2 / 5 / 19 | 0 |
| frontend | 2 / 13 / 23 | 5: firebase 10.14.1 → @firebase/firestore → @grpc/grpc-js 1.9.16 (GHSA-m9gg-hp2v-232j) and undici 6.19.7 |
| e2e | 1 / 14 / 21 | 0 (dev-only dir) |

Trial resolution (lockfile-only, then thrown away) of the versions below gave **0 high, 0 critical in every dir, prod and dev**. What's left is moderate only (react-router 6, glob/minimatch via workbox, uuid via firebase-admin 12), which the spec excludes.

- frontend: `firebase ^12.19.0`, `overrides: { "@grpc/grpc-js": "^1.14.7" }`, `vite ^6.4.6`, `vitest ^4.1.12`, `vite-plugin-pwa ^1.3.0`, then `npm audit fix` (brace-expansion, browserslist, fast-uri, nanoid, postcss, source-map-js, zod).
- backend: `vitest ^4.1.12`, then `npm audit fix` (brace-expansion).
- e2e: `firebase-tools ^15.37.0`, then `npm audit fix` (brace-expansion, compression, fast-uri, js-yaml, undici 8).

Deviations from the spec's hints, with the reason:
- **vitest ≥3.2.6 isn't enough.** vitest 3.2.x depends on `tinypool ^1.1.1` (newest 1.1.1), still critical under GHSA-85c8-ppgw-ccpr (<2.1.2). vitest 4 dropped tinypool, so it's 4.1.12.
- **vite-plugin-pwa must move 0.20 → 1.3.** 0.20 only accepts vite ≤5. 0.21.2 accepts vite 6 but pulls workbox-build 7.3.0 → serialize-javascript 6.0.2 (high GHSA-5c6j-r48x-rmvq). 1.3.0 uses workbox-build 7.4.1 and is clean.
- firebase 12.19.0 (newest 12) rather than 13: the frontend imports only `firebase/app` and `firebase/auth`, and 12 is the smaller jump.

Draft gates PR #37, first CI run (2026-11-22). The PR image scan and the deployed image gave the same result: **6 HIGH, 0 CRITICAL, all in the npm bundled with `node:24.22.3-alpine`**. Alpine 3.24.4 packages: 0. `/app/node_modules`: 0. Every finding has a fixed version, so Task 2 removes npm/npx from the runtime stage, which never uses them.

| path in image | package | installed | IDs (fixed in) |
|---|---|---|---|
| `usr/local/lib/node_modules/npm/node_modules/brace-expansion` | brace-expansion | 5.0.9 | CVE-2026-102276 (5.0.10), CVE-2026-102278 (5.0.11) |
| `usr/local/lib/node_modules/npm/node_modules/undici` | undici | 6.28.0 | CVE-2026-109383, CVE-2026-109869, CVE-2026-87018 (6.29.1), CVE-2026-19534 (6.28.1) |

The same run was red, as expected, on `Audit prod deps (frontend)` (Task 1) and on the nightly's `Dev deps` jobs for backend, frontend and e2e (Tasks 3–5).

## Review Focus

1. The nightly can't reach the registry or nodejs.org (auth or network error): the job must fail, not pass with nothing scanned. Covered in Task 8 (`set -euo pipefail`, no fallbacks) and Task 7 (the script exits non-zero on bad input).
2. `uses:` written in other forms: quoted, `docker://image@sha256:…`, local `./path`, reusable `owner/repo/.github/workflows/x.yml@ref`, a trailing comment. Pins check tests in Task 6.
3. Node versions with or without the `v` prefix, a newer *non-security* release, a security release in a *different* major. Tests in Task 7.
4. firebase 12 changes auth behaviour (popup/email sign-in, emulator connection). Covered by the existing `LoginPage.test.tsx` and the e2e suite in Task 1.
5. vite-plugin-pwa 1.x stops producing `sw.js` / `manifest.webmanifest`, so installed PWAs stop updating. Checked by comparing the `dist/` file lists in Task 4.

---

## PR order

0. **Orchestrator, before any PR:** Dependabot alerts on (Settings, step 0).
1. **Gates PR as a draft** (this branch, `chore/audit-checks`): Tasks 6–10 written and pushed, PR opened as a **draft** so Trivy runs in CI. Record the image findings in this plan. Not merged yet.
2. **PR 1 `fix/audit-prod-deps`**: Tasks 1–2. Merge, watch the Hosting (and Cloud Run, if Task 2 touches backend) deploys.
3. **PR 2 `fix/audit-dev-deps`** (from main after PR 1): Tasks 3–5. Merge, watch the deploys.
4. **Gates PR**: rebase onto main, Task 11 (red once, then green), mark ready, merge, watch the deploys, dispatch the nightly.
5. **Orchestrator:** security updates on, required checks on the ruleset (Settings, step 4).

Verification for every PR, run in its worktree after `npm ci` in `backend`, `frontend`, `e2e` (installs stay in the worktree):
- `backend`: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run format:check`
- `frontend`: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run format:check`
- `e2e`: `export PLAYWRIGHT_BROWSERS_PATH=$PWD/node_modules/.pw-browsers`, `npx playwright install chromium`, `npm test` (browsers stay inside the worktree)
- `docker build -t corgi-backend:verify backend` succeeds
- CI on the PR green (Frontend, Backend, E2E, plus the gates jobs once they exist)

---

## PR 1: `fix/audit-prod-deps`

### Task 1: firebase 12 + grpc-js override (frontend)

**Files:** Modify `frontend/package.json`, `frontend/package-lock.json`. Any source change firebase 12 forces in `frontend/src/firebase.ts` or callers of `firebase/auth`.

- [ ] **Red:** `cd frontend && npm audit --omit=dev --audit-level=high` exits 1, listing `@grpc/grpc-js` and `undici`.
- [ ] Set `"firebase": "^12.19.0"` and a top-level `"overrides": { "@grpc/grpc-js": "^1.14.7" }`, then `npm install`.
- [ ] **Green:** the same command exits 0. `npm ls @grpc/grpc-js` shows only `1.14.7 overridden`. `npm ls undici` is empty.
- [ ] Full verification (list above). If firebase 12 breaks something the override doesn't explain, stop and report; don't widen the PR.
- [ ] Bundle check: `grep -rlE "grpc|@grpc" frontend/dist` → expected nothing. The PR says plainly that the frontend never imports Firestore (only `firebase/app` and `firebase/auth`), so no test loads grpc-js. The suites prove the upgrade, not the override's runtime behaviour.
- [ ] Commit `fix(frontend): firebase 12 and grpc-js override for high advisories`. The PR body carries the four proofs from spec §6.

### Task 2: backend image high+ (only if the draft gates PR's Trivy job is red)

**Files:** `backend/Dockerfile`, possibly `backend/package*.json`.

- [ ] **Red:** the draft gates PR's `Scan backend image` job fails. Copy the findings (package, ID, fixed-in) into this plan under Findings.
- [ ] Fix by the cheapest root cause. Bundled npm in the runtime stage: delete npm/npx from the runtime stage after `npm ci --omit=dev`. Alpine package: `apk upgrade --no-cache <pkg>` or a newer alpine variant tag. Prod `node_modules`: bump the dep.
- [ ] A high+ with **no fix anywhere**: stop and bring it to the user (ID, package, why). Never add an exception yourself.
- [ ] **Green:** locally `docker build` + Trivy run per Task 8's command passes. After the PR merges and the gates PR is rebased, its scan job is green.
- [ ] Commit `fix(backend): remove high vulnerabilities from runtime image`.

## PR 2: `fix/audit-dev-deps`

### Task 3: backend vitest 4

**Files:** `backend/package.json`, `backend/package-lock.json`, any test or `backend/vitest.config.ts` change vitest 4 requires.

- [ ] **Red:** `cd backend && npm audit --audit-level=high` exits 1 (vitest, tinypool critical; vite, brace-expansion, …).
- [ ] `vitest ^4.1.12`, `npm install`, `npm audit fix`.
- [ ] **Green:** `npm audit --audit-level=high` exits 0, and `npm test` runs the same number of tests as on main (record both counts).
- [ ] Commit `chore(backend): vitest 4 and transitive security fixes`.

### Task 4: frontend vite 6, vitest 4, vite-plugin-pwa 1.3

**Files:** `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts` if a type error forces importing `defineConfig` from `vitest/config`.

- [ ] Before changing anything, on main: `npm run build && (cd dist && find . -type f | sed 's/-[A-Za-z0-9_]\{8\}\././' | sort) > $SCRATCH/dist-before.txt`.
- [ ] **Red:** `cd frontend && npm audit --audit-level=high` exits 1.
- [ ] `vite ^6.4.6`, `vitest ^4.1.12`, `vite-plugin-pwa ^1.3.0`, `npm install`, `npm audit fix`. Keep `@vitejs/plugin-react` 4.x (its peers accept vite 6).
- [ ] **Green:** `npm audit --audit-level=high` exits 0. Test count is unchanged. The same `dist` listing diffed against before: `sw.js`, `workbox-*.js`, `manifest.webmanifest`, `registerSW.js` all still exist, and nothing else is missing.
- [ ] Commit `chore(frontend): vite 6, vitest 4, vite-plugin-pwa 1.3 for high advisories`.

### Task 5: e2e firebase-tools

**Files:** `e2e/package.json`, `e2e/package-lock.json`.

- [ ] **Red:** `cd e2e && npm audit --audit-level=high` exits 1 (proxy-addr critical via firebase-tools 15.24).
- [ ] `firebase-tools ^15.37.0`, `npm install`, `npm audit fix`.
- [ ] **Green:** audit exits 0. The full e2e suite passes (emulators start from `e2e/node_modules/.bin/firebase`).
- [ ] Commit `chore(e2e): firebase-tools 15.37 and transitive security fixes`. `npx firebase-tools@15.22.1` in the deploy workflows is out of scope (spec §12).

## Gates PR: `chore/audit-checks`

### Task 6: Actions pin check + pin everything

**Files:** Create `.github/scripts/action-pins.mjs`, `.github/scripts/action-pins.test.mjs`. Modify all four workflows, `backend/Dockerfile` (both `FROM` lines get the digest).

**Interfaces:** `findUnpinned(workflowText: string): string[]` returns the offending `uses:` values. The CLI `node .github/scripts/action-pins.mjs <dir>` prints `file: value` for each and exits 1 if there are any, 0 if none.

- [ ] Tests (`node:test`), red first: `actions/checkout@v4` → reported; `actions/checkout@` + 40 hex → not reported; quoted `"actions/checkout@v4"` → reported; trailing ` # v4` after a SHA → reported (no-comments rule); `./local-action` → not reported; `docker://alpine:3` → reported, `docker://alpine@sha256:<64 hex>` → not; `owner/repo/.github/workflows/x.yml@main` → reported; a 39-char hex → reported.
- [ ] Implement until `node --test .github/scripts/` passes.
- [ ] Pin each action to the commit its current tag points to (`gh api repos/<o>/<r>/commits/<tag> --jq .sha`), with backend.yml's `google-github-actions/auth@v2` moved to v3. Then `node .github/scripts/action-pins.mjs .github/workflows` exits 0.
- [ ] Commit `chore: pin GitHub Actions and base image by SHA, with a check`.

### Task 7: Node security-release check

**Files:** Create `.github/scripts/node-security.mjs`, `.github/scripts/node-security.test.mjs`.

**Interfaces:** `newerSecurityRelease(deployed: string, releases: {version: string, security: boolean}[]): string | null`. The CLI `node .github/scripts/node-security.mjs <deployed-version> <index.json path>` exits 1 and prints `production runs <x>; security release <y> exists in the same major` when a release is found, prints the result and exits 0 when there isn't one, and exits 2 on an unparsable version or JSON.

- [ ] Tests, red first: `v24.22.3` against a newer `v24.23.0` with `security: true` → `v24.23.0`. A newer non-security `v24.23.0` → `null`. A security `v26.1.0` → `null` (other major). An equal version → `null`. `24.22.3` without `v` works. Garbage input → throws. With several newer, it returns the newest security one.
- [ ] Implement until green.
- [ ] Commit `feat: check deployed Node against security releases`.

### Task 8: PR gate jobs in `ci.yml`

**Files:** Modify `.github/workflows/ci.yml`.

New jobs (the `name:` values become required checks):
- `Audit prod deps (backend)` and `Audit prod deps (frontend)`: setup-node 24.22.3, `npm audit --omit=dev --audit-level=high` in the dir (no install needed).
- `Scan backend image`: `docker build -t corgi-backend:ci backend`, then `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock <trivy pinned> image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 corgi-backend:ci`.
- `Actions pinned`: `node --test .github/scripts/` and `node .github/scripts/action-pins.mjs .github/workflows`.

- [ ] Push and open as a **draft** PR (rollout step 1). Record each job's result in Findings. Red jobs here are expected until PR 1/2 merge.
- [ ] Commit `ci: audit prod deps, scan backend image, check action pins`.

### Task 9: `audit-nightly.yml`

**Files:** Create `.github/workflows/audit-nightly.yml`.

Jobs (each separate, `defaults.run.shell: bash` with `set -euo pipefail`):
- `prod-deps` (matrix `backend`, `frontend`): `npm audit --omit=dev --audit-level=high`.
- `dev-deps` (matrix `backend`, `frontend`, `e2e`): `npm audit --audit-level=high`.
- `deployed-image`: auth (same inputs as backend.yml), `gcloud auth configure-docker asia-northeast1-docker.pkg.dev --quiet`, revision = `gcloud run services describe corgi-backend --region asia-northeast1 --format='value(status.latestReadyRevisionName)'`, image = `gcloud run revisions describe "$rev" --region asia-northeast1 --format='value(status.imageDigest)'`, `docker pull "$image"`, the Trivy command from Task 8 on `$image`, `node_version=$(docker run --rm --entrypoint node "$image" --version)`, `curl -fsSL https://nodejs.org/dist/index.json -o "$RUNNER_TEMP/index.json"`, `node .github/scripts/node-security.mjs "$node_version" "$RUNNER_TEMP/index.json"`. The image ref is never echoed to the summary.
- `actions-pins`: same as the PR job.

- [ ] Run it on the branch: `gh workflow run audit-nightly.yml --ref chore/audit-checks` (WIF checks only the repository for corgi, so a branch run authenticates). All jobs green after PR 1/2, or failures recorded.
- [ ] Commit `ci: nightly audit of deps, deployed image, Node runtime and action pins`.

### Task 10: `dependabot.yml`

**Files:** Create `.github/dependabot.yml`.

- `npm`, `directories: ["/backend", "/frontend", "/e2e"]`, weekly, `open-pull-requests-limit: 0`.
- `docker`, `directories: ["/backend"]`, weekly, one group `docker` with `patterns: ["*"]`.
- `github-actions`, `directories: ["/"]`, weekly, one group `actions` with `patterns: ["*"]`.

- [ ] After the merge, Insights → Dependency graph → Dependabot lists the three ecosystems with no config error, and no npm version-update PR opens.
- [ ] Commit `chore: dependabot security-only for npm, weekly grouped for docker and actions`.

### Task 11: red once, then green, then ready

- [ ] Throwaway branch `demo/audit-red` from the gates branch: add `"lodash": "4.17.20"` to `backend` dependencies (high GHSA-35jh-r3h4-6jhm) with its lockfile. Push and open a draft PR. `Audit prod deps (backend)` must fail and `Scan backend image` should fail too. Save the run URL.
- [ ] Close that PR without merging, and delete the branch (`git push origin --delete demo/audit-red`).
- [ ] Rebase the gates PR on main (after PR 1/2). Every job is green. Put the red run URL in the PR body and mark the PR ready. The orchestrator merges and watches the Hosting + Firestore-rules deploys that the workflow edits trigger (the Cloud Run deploy runs if `backend/Dockerfile` changed).
- [ ] After the merge: `gh workflow run audit-nightly.yml --ref main` is green. Link the run.

---

## GitHub settings (orchestrator, via `gh api`)

| When | Setting | Command | Read-back |
|---|---|---|---|
| Step 0, before the draft gates PR | Dependabot alerts + dependency graph (today: 404 = off) | `gh api -X PUT repos/hokita/corgi/vulnerability-alerts` | `gh api repos/hokita/corgi/vulnerability-alerts -i` → 204 |
| Step 4, after the gates PR merges | Dependabot security updates (today: disabled) | `gh api -X PUT repos/hokita/corgi/automated-security-fixes` | `.security_and_analysis.dependabot_security_updates.status == "enabled"` |
| Step 4 | Required checks on the existing ruleset "Protect main" (id 19733361), keeping deletion / non_fast_forward / pull_request (0 approvals) / no bypass | `gh api -X PUT repos/hokita/corgi/rulesets/19733361` with the current rules plus `required_status_checks` with contexts `Frontend`, `Backend`, `E2E`, `Audit prod deps (backend)`, `Audit prod deps (frontend)`, `Scan backend image`, `Actions pinned` | `gh api repos/hokita/corgi/rulesets/19733361`, and a test PR shows them as "Required" |
| — | Secret scanning + push protection | already enabled on corgi; nothing to do | — |

User-owned, not automated: GitHub notification setting Actions → "failed workflows only" with email (default). Volta default Node 24.16.0 on the Mac (spec §5).
