# GitHub Actions Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs in `.github/workflows/frontend.yml`, delete both `cloudbuild.yaml` files, and commit — making GitHub Actions the sole CI/CD system.

**Architecture:** Single commit touching three files (one edit, two deletes). No code changes — CI/CD config only. Verification is done by monitoring the GitHub Actions run and checking the live app.

**Tech Stack:** GitHub Actions, Google Cloud Run, Firebase Hosting, Workload Identity Federation

## Global Constraints

- All changes in a single commit
- Do not modify `.github/workflows/backend.yml` — it is correct as-is
- Firebase client config values must match exactly what was in `frontend/cloudbuild.yaml`

---

### Task 1: Fix `frontend.yml` and remove Cloud Build configs

**Files:**
- Modify: `.github/workflows/frontend.yml`
- Delete: `backend/cloudbuild.yaml`
- Delete: `frontend/cloudbuild.yaml`

**Note:** This is CI/CD configuration — there are no unit tests to write. Verification is the GitHub Actions run itself and checking the live app afterward.

- [ ] **Step 1: Fix the Build step in `frontend.yml`**

The current Build step has `working-directory: frontend` duplicated (once before `env:`, once after `run:`). Replace the entire Build step with:

```yaml
      - name: Build
        working-directory: frontend
        env:
          # Firebase client config is public-facing — security enforced by Firebase Security Rules, not by keeping keys secret.
          VITE_FIREBASE_API_KEY: AIzaSyCwAA7MJGTsn6wNMsJrPwSj_Lt3d4Sx2Ho
          VITE_FIREBASE_AUTH_DOMAIN: corgi-8732c.firebaseapp.com
          VITE_FIREBASE_PROJECT_ID: corgi-8732c
          VITE_API_URL: https://corgi-backend-838648453884.asia-northeast1.run.app
        run: npm run build
```

The full `.github/workflows/frontend.yml` after the edit:

```yaml
name: Deploy Frontend

on:
  push:
    branches:
      - main
    paths:
      - 'frontend/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install dependencies
        working-directory: frontend
        run: npm ci

      - name: Lint
        working-directory: frontend
        run: npm run lint

      - name: Test
        working-directory: frontend
        run: npm test

      - name: Build
        working-directory: frontend
        env:
          # Firebase client config is public-facing — security enforced by Firebase Security Rules, not by keeping keys secret.
          VITE_FIREBASE_API_KEY: AIzaSyCwAA7MJGTsn6wNMsJrPwSj_Lt3d4Sx2Ho
          VITE_FIREBASE_AUTH_DOMAIN: corgi-8732c.firebaseapp.com
          VITE_FIREBASE_PROJECT_ID: corgi-8732c
          VITE_API_URL: https://corgi-backend-838648453884.asia-northeast1.run.app
        run: npm run build

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Install Firebase CLI
        run: npm install -g firebase-tools

      - name: Deploy to Firebase Hosting
        run: firebase deploy --only hosting --project corgi-8732c
```

- [ ] **Step 2: Validate the YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/frontend.yml'))" && echo "VALID"
```

Expected output: `VALID`

- [ ] **Step 3: Delete Cloud Build configs**

```bash
rm backend/cloudbuild.yaml frontend/cloudbuild.yaml
```

Verify they're gone:

```bash
ls backend/cloudbuild.yaml frontend/cloudbuild.yaml 2>&1
```

Expected output:
```
ls: backend/cloudbuild.yaml: No such file or directory
ls: frontend/cloudbuild.yaml: No such file or directory
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/frontend.yml
git rm backend/cloudbuild.yaml frontend/cloudbuild.yaml
git commit -m "ci: migrate to GitHub Actions, remove Cloud Build configs

- Fix duplicate working-directory key in frontend.yml (caused workflow file issue)
- Hardcode Firebase client config (was referencing unset GitHub vars)
- Delete backend/cloudbuild.yaml and frontend/cloudbuild.yaml"
```

- [ ] **Step 5: Push and monitor the workflows**

```bash
git push origin main
```

Then watch the runs:

```bash
gh run watch --repo hokita/corgi
```

Expected: both `Deploy Frontend` and `Deploy Backend` workflows trigger. The commit deletes `frontend/cloudbuild.yaml` (matches `frontend/**`) and `backend/cloudbuild.yaml` (matches `backend/**`), so both path filters are satisfied.

- [ ] **Step 6: Verify the live app**

After the `Deploy Frontend` workflow completes successfully:

1. Open `https://corgi-8732c.web.app` in a browser
2. Confirm no `auth/invalid-api-key` error in the browser console
3. Confirm login/auth flow works

- [ ] **Step 7: Disable Cloud Build triggers in GCP Console (manual)**

This step cannot be automated — do it in the browser:

1. Go to [GCP Console → Cloud Build → Triggers](https://console.cloud.google.com/cloud-build/triggers?project=corgi-8732c)
2. Find the backend trigger and disable or delete it
3. Find the frontend trigger and disable or delete it

Without this step, Cloud Build will fire on push, find no `cloudbuild.yaml`, and log errors. Not harmful but noisy.
