---
name: github-actions-migration
description: Migrate CI/CD from Cloud Build to GitHub Actions — fix frontend.yml bugs, hardcode Firebase config, delete cloudbuild.yaml files
metadata:
  type: project
---

# GitHub Actions Migration Design

## Goal

Consolidate CI/CD on GitHub Actions and remove Cloud Build configuration. Current state has both systems active; GitHub Actions workflows have two bugs preventing successful deploys.

## Current State

- `backend/cloudbuild.yaml` — Cloud Build pipeline for backend (install → lint → test → build → docker push → Cloud Run deploy)
- `frontend/cloudbuild.yaml` — Cloud Build pipeline for frontend (install → lint → test → build → Firebase deploy), Firebase config hardcoded
- `.github/workflows/backend.yml` — GitHub Actions backend pipeline, syntactically correct, last ran successfully
- `.github/workflows/frontend.yml` — GitHub Actions frontend pipeline, two bugs (see below)

## Bugs to Fix in `frontend.yml`

**Bug 1 — Duplicate `working-directory` key**
The Build step has `working-directory: frontend` on both line 37 and line 44. YAML duplicate keys cause GitHub to reject the file immediately with "workflow file issue" (0s run). Every recent frontend workflow run has failed for this reason.

**Bug 2 — Firebase config from unset GitHub variables**
The Build step uses `${{ vars.VITE_FIREBASE_API_KEY }}` and three other `vars.*` references. These GitHub repository variables are not set, so the build produces a frontend with empty env vars → `auth/invalid-api-key` error in the browser.

Fix: replace `vars.*` references with the same hardcoded values Cloud Build was using. Firebase client config is intentionally public-facing (security enforced by Firebase Security Rules, not by keeping the key secret).

**Hardcoded values (from `frontend/cloudbuild.yaml`):**
- `VITE_FIREBASE_API_KEY=AIzaSyCwAA7MJGTsn6wNMsJrPwSj_Lt3d4Sx2Ho`
- `VITE_FIREBASE_AUTH_DOMAIN=corgi-8732c.firebaseapp.com`
- `VITE_FIREBASE_PROJECT_ID=corgi-8732c`
- `VITE_API_URL=https://corgi-backend-838648453884.asia-northeast1.run.app`

## Files to Delete

- `backend/cloudbuild.yaml`
- `frontend/cloudbuild.yaml`

## Files Unchanged

- `.github/workflows/backend.yml` — correct as-is

## Manual Step (after commit lands)

Disable or delete both Cloud Build triggers in GCP Console → Cloud Build → Triggers. Without this, Cloud Build will fire on push, find no `cloudbuild.yaml`, and log errors. Not harmful but noisy.

## Verification

After the frontend workflow completes, open the app in a browser. The `auth/invalid-api-key` error should be gone.

## Scope

All changes land in a single commit. No staged approach — removing Cloud Build immediately gives one authoritative CI/CD system with no ambiguity about which pipeline is active.
