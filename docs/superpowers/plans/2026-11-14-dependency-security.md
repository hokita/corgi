# Production Dependency + Node.js Runtime Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the corgi backend's production runtime from Node 24.18.0 to the fixed **Node 24.22.3** (2026-11-11 Node.js security release) and pin every Node version in the repo to it. Clear the patch/minor-fixable production `npm audit` findings in `backend/` (Cloud Run) and `frontend/` (Firebase Hosting) by refreshing the lockfiles. Ship both through the normal GitHub Actions deploys and prove that the deployed runtime is 24.22.3.

**Architecture:**
- **Runtime:** pin `node:24.22.3-alpine` in both Dockerfile stages instead of the floating `node:24-alpine`, and add `USER node` to the runtime stage to match owlet and hamster. Set every setup-node and volta pin to `24.22.3`.
- **Libraries:** lockfile-only changes, with no `package.json` dependency edits and no `overrides`. Every target is inside the existing semver ranges, so `npm update <pkg...>` (npm 11, lockfileVersion 3) rewrites only `package-lock.json`.
- **One parent bump:** express 4.22.2 pins `qs ~6.15.1`, so express must move to 4.22.3 (`qs ~6.16.0`, still inside `^4.18.0`) before qs reaches 6.16.x.

**Tech Stack:** Node 24 / npm 11, Docker (node alpine), Express 4, firebase-admin 12, Vite + React 18, react-router-dom 6, Vitest, Playwright, GitHub Actions → Cloud Run / Firebase Hosting, Volta.

**Spec:** Reports from the orchestrating session (read-only), in `/private/tmp/claude-501/-Users-hokita-ghq-github-com-hokita-orch/f7be1767-ea7c-4ee6-b96d-13a1a4575d88/scratchpad/`:
- `node-audit.md` and `node-audit-libs.md` (sections `corgi/backend`, `corgi/frontend`)
- `node-runtime.md` (Node November 2026 release; corgi rows)

## Global Constraints

- Work only in this worktree: `/Users/hokita/.herdr/worktrees/corgi/fix-dependency-security` (branch `fix/dependency-security`). **Never touch `~/ghq/github.com/hokita/corgi`**: it has uncommitted July changes.
- Target Node version: **exactly `24.22.3`** everywhere (Dockerfile both stages `node:24.22.3-alpine`, every `setup-node` `node-version`, every volta pin). No floating `'24'` and no `24-alpine`.
- Library updates: patch/minor only. No majors. No `npm audit fix --force`. No dependency edits in `package.json`; only the `volta.node` field changes there.
- Dev-only tooling (vitest, vite, esbuild, eslint, typescript-eslint, vite-plugin-pwa, workbox, …) is out of scope for library fixes.
- Deploys happen only via GitHub Actions on push to `main`. Never run `gcloud`/`firebase` deploy commands by hand (`corgi-deploy` skill). `gcloud ... describe` (read-only) is fine.
- "Push" means push **and** confirm that the GitHub Actions deploy succeeded.

## Re-verification against current files (done 2026-11-14 while writing this plan)

- `git fetch`: origin/main is still `9454539`, the commit both audits used.
- **Libraries:** `npm audit --omit=dev` reproduces the report: backend 16 findings (1 critical, 4 high, 10 moderate, 1 low), frontend 14 (5 high, 9 moderate). The installed versions below come from the current lockfiles.
- **Node pins (current files):**

  | file | line | current | target |
  |---|---|---|---|
  | `backend/Dockerfile` | 1 (builder) | `FROM node:24-alpine AS builder` | `FROM node:24.22.3-alpine AS builder` |
  | `backend/Dockerfile` | 9 (runtime) | `FROM node:24-alpine` | `FROM node:24.22.3-alpine` |
  | `backend/Dockerfile` | runtime stage | no `USER` (runs as root) | `USER node` after the `COPY --from=builder` line, before `EXPOSE` (exact hamster layout) |
  | `.github/workflows/backend.yml` | 22 | `node-version: '24'` | `node-version: '24.22.3'` |
  | `.github/workflows/frontend.yml` | 27 | `node-version: '24.18.0'` | `node-version: '24.22.3'` |
  | `.github/workflows/ci.yml` | 16, 45, 79 (frontend, backend, e2e jobs) | `node-version: '24.18.0'` | `node-version: '24.22.3'` |
  | `backend/package.json` | 42 | `"node": "24.17.0"` (volta) | `"node": "24.22.3"` |
  | `frontend/package.json` | 51 | `"node": "24.17.0"` (volta) | `"node": "24.22.3"` |
  | `e2e/package.json` | 15 | `"node": "24.17.0"` (volta) | `"node": "24.22.3"` |

  There are no `.nvmrc`, `.node-version`, `.tool-versions` or `engines` fields to update.
- **Release facts:**
  - `nodejs.org/dist/index.json` lists `v24.22.3` (2026-11-10, `security: true`).
  - Docker Hub tag `node:24.22.3-alpine` exists (amd64 digest `sha256:d8d97e47…`).
- **Production:** Cloud Run revision `corgi-backend-00048-lrw` (2026-07-27) runs image `NODE_VERSION=24.18.0`.
- **Exposure:** low, since the app is a plain `node:http` Express `listen(port)` behind Google Front End with port `http1`, and no TLS/HTTP2 server. The release also carries llhttp and undici fixes with no CVE ID, plus client-side CVEs (https.Agent `ca` reuse, proxy-credential leak, zlib).
- **`USER node` safety:**
  - `backend/src` has no `fs`, `readFile`, `writeFile`, `mkdir`, `tmpdir` or `__dirname` use, so it writes nothing to disk.
  - It listens on `PORT` (8080), which is above 1024.
  - `/app` files copied as root stay world-readable, which is all the node user needs.
  - Task 1 verifies this in a real container.

## Library table

### backend (Cloud Run: reachable)

| library | installed → target | advisories cleared | how it gets there |
|---|---|---|---|
| express (parent) | 4.22.2 → 4.22.3 | — (needed for qs) | `npm update express` (direct, `^4.18.0`) |
| proxy-addr | 2.0.7 → 2.0.8 | GHSA-jqcg-44mw-7w3h (critical) | `npm update proxy-addr` (express `~2.0.7`) |
| body-parser | 1.20.5 → 1.20.9 | GHSA-27r3-jxmh-p828, GHSA-v422-hmwv-36x6 | `npm update body-parser` (express `~1.20.5`) |
| qs | 6.15.2 → 6.16.2 | GHSA-4mjr-xmp4-gh2g, -x5fp-wj9c-mxmx, -6pq8-jhm2-2vcw (needs >6.16.0) | parent bump: express 4.22.3 + body-parser 1.20.9 both take `qs ~6.16.0`, then `npm update qs`. The 6.15.4 backport does **not** clear GHSA-6pq8 |
| node-forge | 1.4.0 → 1.4.3 | 21 advisories (≤1.4.2) | `npm update node-forge` (firebase-admin `^1.3.1`) |
| @fastify/busboy | 3.2.0 → 3.2.5 | GHSA-gxm5-99cw-xjw9, -x8mw-p69m-v3mx, -xjh9-v7x6-24jw | `npm update @fastify/busboy` (firebase-admin `^3.0.0`) |
| @grpc/grpc-js | 1.14.4 → 1.14.7 | GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4 | `npm update @grpc/grpc-js` (google-gax `^1.10.9`) |
| protobufjs | 7.6.4 → 7.6.6 | GHSA-j3f2-48v5-ccww | `npm update protobufjs` (firestore `^7.2.6`, google-gax `^7.3.2`; stays on 7.x) |
| fast-xml-parser | 5.10.1 → 5.12.1 | GHSA-474x-hrwr-fgx4 (low; used by `src/tools/anthropicNews.ts`) | `npm update fast-xml-parser` (direct, `^5.10.1`; minor) |

### frontend (Firebase Hosting SPA)

| library | installed → target | advisories cleared | how it gets there |
|---|---|---|---|
| react-router-dom | 6.30.4 → 6.30.6 | GHSA-jjmj-jmhj-qwj2 (range `>=6.30.2 <=6.30.5`, patched 6.30.6) | `npm update react-router-dom` (direct, `^6.23.0`) |
| react-router | 6.30.4 → 6.30.6 | **none.** GHSA-wrjc-x8rr-h8h6 and GHSA-337j-9hxr-rhxg cover all of 6.x (`<7.18.0`); see "later" | comes along with react-router-dom 6.30.6 (exact pin); `@remix-run/router` 1.23.3 → 1.23.4 |
| protobufjs | 7.6.4 → 7.6.6 | GHSA-j3f2-48v5-ccww | `npm update protobufjs` (@grpc/proto-loader `^7.2.5`). Node-only firestore gRPC path, **not in the browser bundle**. Updated because it costs nothing |

**react-router resolution:** both claims are partly true. GitHub advisory data:
- GHSA-jjmj-jmhj-qwj2 affects `react-router-dom >=6.30.2 <=6.30.5`. **The 6.30.6 patch clears it.**
- GHSA-wrjc-x8rr-h8h6 and GHSA-337j-9hxr-rhxg affect `react-router <7.18.0`, and the only fix is **7.18.0 (major)**. No 6.x patch clears them, even though npm prints `fixAvailable: true`. Exposure is limited: client-only `<BrowserRouter>` (`frontend/src/main.tsx`) with no SSR hydration, so GHSA-337j does not apply.
- These two stay in the audit after this plan. That is expected.

### Note only: frontend firebase gRPC/undici chain

`firebase` 10.14.1 → `@grpc/grpc-js` 1.9.16 (pinned `~1.9.0`) and `undici` 6.19.7 (exact pin) are high findings. They are Node-build only and not in the browser bundle (Task 3 re-checks this). No firebase release clears them, and npm's `firebase@9.14.0` is a downgrade. These 10 entries stay in the audit output.

## Review Focus

1. **`USER node` in the runtime container:** the server must start, bind 8080 and serve `/health` as uid 1000. Firebase Admin must still initialise with Cloud Run's metadata-server credentials, which are not file-based, so this works without root. Task 1 Step 4 and the post-deploy smoke test cover it.
2. **Deployed runtime really is 24.22.3:** a `:latest` tag or a cached base layer could leave the old runtime in place. Verify the new revision's image digest config (`NODE_VERSION`, `User`), not just that the workflow ran (Task 4 Step 4).
3. **express 4.22.3 / body-parser 1.20.9 / qs 6.16 request parsing:** JSON bodies on the chat/SSE endpoints must still parse (supertest route tests and e2e).
4. **fast-xml-parser 5.10 → 5.12:** `anthropicNews.ts` must parse the RSS feed into the same shape (`anthropicNews.test.ts`).
5. **Collateral churn:** the diff must not touch `package.json` dependency fields, and lockfiles must not gain dev-tooling majors. `npm ci` must still succeed on Node 24.22.3.

---

### Task 0: Baseline

**Files:** none modified.

- [ ] **Step 1: Confirm the branch and that origin/main has not moved**

Run: `cd /Users/hokita/.herdr/worktrees/corgi/fix-dependency-security && git fetch origin && git status -sb && git log --oneline -1 origin/main`
Expected: on `fix/dependency-security`, clean apart from this untracked plan file, origin/main = `9454539`. If it moved, rebase and re-check the version tables above.

- [ ] **Step 2: Save baseline audits** (`$SCRATCH` = this session's scratchpad dir)

```bash
(cd backend  && npm audit --omit=dev > "$SCRATCH/backend-audit-before.txt"; npm audit --omit=dev --json | jq .metadata.vulnerabilities)
(cd frontend && npm audit --omit=dev > "$SCRATCH/frontend-audit-before.txt"; npm audit --omit=dev --json | jq .metadata.vulnerabilities)
```
Expected: backend total 16 (critical 1, high 4, moderate 10, low 1); frontend total 14 (high 5, moderate 9).

- [ ] **Step 3: Record the current production state** (read-only)

```bash
gcloud run services describe corgi-backend --region asia-northeast1 --project corgi-8732c \
  --format='value(status.latestReadyRevisionName)'          # expect corgi-backend-00048-lrw
curl -s https://corgi-8732c.web.app/ | grep -o 'assets/index-[^"]*\.js'
```
Record both values.

- [ ] **Step 4: Local Node 24.22.3 via Volta**

Run: `volta install node@24.22.3` (this also makes it the global default and replaces the unfixed 24.16.0). Once Task 1 sets the pins, Volta resolves `24.22.3` inside `backend/`, `frontend/` and `e2e/` on its own.
Expected: `node -v` prints `v24.22.3`. All later local checks run on the fixed runtime.

---

### Task 1: Pin Node 24.22.3 everywhere + run the container as `node`

**Files:**
- Modify: `backend/Dockerfile` (lines 1, 9; add `USER node` in runtime stage)
- Modify: `.github/workflows/backend.yml:22`, `.github/workflows/frontend.yml:27`, `.github/workflows/ci.yml:16,45,79`
- Modify: `backend/package.json:42`, `frontend/package.json:51`, `e2e/package.json:15` (volta only)

- [ ] **Step 1: Make the edits** in the "Node pins" table above. The runtime stage ends up as:

```dockerfile
FROM node:24.22.3-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: No stray floating pins remain**

Run: `git grep -nE "node-version|FROM node|\"node\": \"" -- .github backend frontend e2e`
Expected: every hit says `24.22.3`. There must be no `'24'`, `24-alpine`, `24.18.0` or `24.17.0` left.

- [ ] **Step 3: Volta picks up the pin**

Run: `for d in backend frontend e2e; do (cd $d && node -v); done`
Expected: `v24.22.3` three times.

- [ ] **Step 4: Container smoke test** (local Docker; build only, no push)

```bash
docker build -t corgi-backend-check backend
docker run --rm --entrypoint node corgi-backend-check -v                 # v24.22.3
docker run --rm --entrypoint id   corgi-backend-check                    # uid=1000(node)
docker image inspect corgi-backend-check --format '{{.Config.User}} {{json .Config.Env}}'   # node … NODE_VERSION=24.22.3
docker run --rm -d --name corgi-check -p 18080:8080 -e PORT=8080 -e FIREBASE_PROJECT_ID=corgi-8732c corgi-backend-check
sleep 3; curl -s localhost:18080/health; docker logs corgi-check; docker rm -f corgi-check
```
Expected: `{"ok":true}` and no `EACCES`/permission errors in the logs. If `/health` needs env vars the container doesn't have, an error about missing config (not a permissions error) is acceptable. Record what happened.

- [ ] **Step 5: Commit** (only when the executor's instructions allow committing)

```bash
git add backend/Dockerfile .github/workflows/backend.yml .github/workflows/frontend.yml .github/workflows/ci.yml backend/package.json frontend/package.json e2e/package.json
git commit -m "fix: pin Node.js 24.22.3 (Nov 2026 security release) and run backend container as node user"
```

---

### Task 2: Backend lockfile refresh

**Files:**
- Modify: `backend/package-lock.json`
- Test: existing `backend/src/**/*.test.ts`

- [ ] **Step 1: Install, update the parent first, then the transitive packages** (on Node 24.22.3)

```bash
cd backend && npm ci
npm update express
npm update proxy-addr body-parser qs node-forge @fastify/busboy @grpc/grpc-js protobufjs fast-xml-parser
```

- [ ] **Step 2: Verify the resolved versions**

Run: `npm ls express proxy-addr body-parser qs node-forge @fastify/busboy @grpc/grpc-js protobufjs fast-xml-parser --omit=dev --all | grep -E 'express@|proxy-addr@|body-parser@|qs@|node-forge@|busboy@|grpc-js@|protobufjs@|fast-xml-parser@' | sort -u`
Expected: express@4.22.3, proxy-addr@2.0.8, body-parser@1.20.9, qs@6.16.2 (no 6.15.x anywhere), node-forge@1.4.3, @fastify/busboy@3.2.5, @grpc/grpc-js@1.14.7, protobufjs@7.6.6, fast-xml-parser@5.12.1. A newer patch inside the same range is fine. A new major is not.

- [ ] **Step 3: Check that the diff is lockfile-only**

Run: `git diff --stat -- backend/package-lock.json && git diff -- backend/package-lock.json | grep '"version"'`
Expected: no major jumps, and `backend/package.json` is unchanged beyond Task 1's volta line.

- [ ] **Step 4: Production audit**

Run: `npm audit --omit=dev`
Expected: only the firebase-admin 12 → uuid chain is left (8 moderate: uuid, gaxios, google-gax, teeny-request, retry-request, @google-cloud/firestore, @google-cloud/storage, firebase-admin). No critical, high or low findings.

- [ ] **Step 5: Full backend checks**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build && npm run format:check`
Expected: all pass.

- [ ] **Step 6: Re-run Task 1 Step 4's container smoke test** with the new lockfile (this covers the `npm ci --omit=dev` path).

- [ ] **Step 7: Commit**

```bash
git add backend/package-lock.json
git commit -m "fix(backend): refresh lockfile for proxy-addr, body-parser, qs, node-forge, busboy, grpc-js, protobufjs, fast-xml-parser advisories"
```

---

### Task 3: Frontend lockfile refresh

**Files:**
- Modify: `frontend/package-lock.json`
- Test: existing `frontend/src/**/*.test.tsx`

- [ ] **Step 1: Install and update**

```bash
cd frontend && npm ci
npm update react-router-dom protobufjs
```

- [ ] **Step 2: Verify the resolved versions**

Run: `npm ls react-router-dom react-router @remix-run/router protobufjs --all`
Expected: react-router-dom@6.30.6, react-router@6.30.6, @remix-run/router@1.23.4, protobufjs@7.6.6. No 7.x.

- [ ] **Step 3: Production audit**

Run: `npm audit --omit=dev`
Expected: react-router-dom and protobufjs are gone. Remaining: react-router (moderate, 7.x-only fix) plus the firebase grpc/undici chain (10), 11 in total.

- [ ] **Step 4: Full frontend checks + bundle check**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build && npm run format:check && (grep -rlE 'grpc-js|undici' dist/ || echo "not in bundle")`
Expected: all pass, then `not in bundle`.

- [ ] **Step 5: Commit**

```bash
git add frontend/package-lock.json
git commit -m "fix(frontend): bump react-router-dom to 6.30.6 and protobufjs to 7.6.6 via lockfile"
```

---

### Task 4: End-to-end check, PR, deploy + runtime confirmation

- [ ] **Step 1: Playwright e2e with Firebase emulators** (recommended)

Run: `cd e2e && npm ci && npm test`
Expected: all specs pass on Node 24.22.3.

- [ ] **Step 2: PR** (only when the user asks to push)

Push `fix/dependency-security` and open a PR against `main` with the body below. Wait for the `CI` workflow (frontend, backend and e2e jobs, now on 24.22.3) to go green.

PR body:
```markdown
## Summary
### Node.js runtime (Nov 2026 security release, fixed 24.22.3)
- Prod backend was on Node **24.18.0** (Cloud Run revision corgi-backend-00048-lrw, deployed 2026-07-27).
- `backend/Dockerfile`: `node:24-alpine` → `node:24.22.3-alpine` (both stages); runtime stage now runs as `USER node`.
- CI `ci.yml` (3 jobs) and `frontend.yml`: `24.18.0` → `24.22.3`; `backend.yml`: `'24'` → `24.22.3`.
- Volta pins (backend/frontend/e2e): `24.17.0` → `24.22.3`.
- Exposure was low (plain node:http behind Google Front End, no TLS/HTTP2 server), but the release also fixes llhttp/undici and client-side issues.

### Dependencies (lockfile only, patch/minor)
- backend: express 4.22.3, proxy-addr 2.0.8 (critical), body-parser 1.20.9, qs 6.16.2, node-forge 1.4.3, @fastify/busboy 3.2.5, @grpc/grpc-js 1.14.7, protobufjs 7.6.6, fast-xml-parser 5.12.1
- frontend: react-router-dom/react-router 6.30.6, protobufjs 7.6.6
- `npm audit --omit=dev`: backend 16 → 8 (uuid chain only), frontend 14 → 11

### Not fixed (major upgrades, follow-ups)
- firebase-admin 12 → 14 (uuid), react-router 7.18 (GHSA-wrjc / GHSA-337j), frontend firebase grpc-js/undici pins (not in bundle)

## Test plan
- lint / typecheck / unit tests / build / format:check for backend and frontend on Node 24.22.3
- local Docker: `node -v` = v24.22.3, `id` = node, `/health` OK
- Playwright e2e
- post-deploy: new Cloud Run revision image `NODE_VERSION=24.22.3`, `User=node`, `/health` OK

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Confirm the deploy workflows after merge**

The merge touches `backend/**` and `frontend/**`, which triggers **Deploy Backend** and **Deploy Frontend**.
```bash
gh run list --workflow=backend.yml  --branch main -L 1
gh run list --workflow=frontend.yml --branch main -L 1
gh run watch <run-id>          # each must conclude "success"
gh run view <backend-run-id> --log | grep -m1 -E 'node.*v?24\.22\.3'   # setup-node resolved 24.22.3
```

- [ ] **Step 4: Prove the deployed backend runtime is 24.22.3** (read-only)

```bash
REV=$(gcloud run services describe corgi-backend --region asia-northeast1 --project corgi-8732c \
  --format='value(status.latestReadyRevisionName)')            # must differ from Task 0's corgi-backend-00048-lrw
gcloud run revisions describe "$REV" --region asia-northeast1 --project corgi-8732c \
  --format='value(metadata.creationTimestamp,status.imageDigest)'   # created after merge; digest = IMG below
IMG=$(gcloud run revisions describe "$REV" --region asia-northeast1 --project corgi-8732c --format='value(status.imageDigest)')
gcloud auth configure-docker asia-northeast1-docker.pkg.dev --quiet
docker buildx imagetools inspect "$IMG" --format '{{json .Image.Config}}' | jq '{User, Env}'
```
Expected: the revision name is newer than the Task 0 value, `Env` contains `NODE_VERSION=24.22.3`, and `User` is `node`. Also confirm `gcloud run services describe ... --format='value(status.traffic[0].revisionName)'` = `$REV` (100% traffic).

- [ ] **Step 5: Live smoke test**

```bash
curl -s https://corgi-backend-838648453884.asia-northeast1.run.app/health   # {"ok":true}
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="corgi-backend" AND resource.labels.revision_name="'"$REV"'" AND severity>=ERROR' \
  --project corgi-8732c --freshness=30m --limit 20                          # no EACCES / startup errors
curl -s https://corgi-8732c.web.app/ | grep -o 'assets/index-[^"]*\.js'   # differs from Task 0 filename
```
Then smoke-test in a browser: sign in, open a conversation, send a message and see it stream. This exercises the non-root container, Firestore via firebase-admin and Gemini, body parsing and frontend routing.

---

## Later (out of scope: major upgrades / outside this repo)

- **firebase-admin 12 → 14 (uuid <11.1.1, GHSA-w5hq-g745-h8pq, moderate ×8 in backend):** only firebase-admin 14 clears the uuid pins. It's a major with Admin SDK API changes, so it needs its own plan.
- **react-router 6 → 7.18 (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg, moderate):** no 6.x fix exists. It's a v7 migration. Low exposure: client-only `BrowserRouter`, no SSR hydration.
- **frontend firebase grpc-js 1.9 / undici 6.19 (high):** every firebase release pins them, and they aren't in the browser bundle. Revisit when firebase moves the pins.
- **Dev tooling (vitest 1 → 3+, vite 5 → 6+, esbuild, eslint/minimatch, vite-plugin-pwa 0.20 → 2):** dev-only.
- **Docker base digest pinning (`node:24.22.3-alpine@sha256:…`) / Dependabot or Renovate for the Node pins:** a hardening follow-up. Without it, the next Node security release again needs a manual bump in 6 places.
- **Local Mac cleanup:** uninstall the unfixed Volta images (20.20.2, 22.23.0, 24.16.0, 24.17.0) after Task 0 Step 4. This affects the machine, not the repo.
