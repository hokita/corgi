# Cloud Build CI/CD Design

**Date:** 2026-06-24
**Project:** corgi (`corgi-8732c`)

---

## Overview

Replace GitHub Actions workflows with Cloud Build triggers. Two `cloudbuild.yaml` files define the pipeline for backend and frontend independently. Cloud Build uses its built-in service account — no WIF, no custom service account, no GitHub Secrets required.

---

## Pipeline Structure

### `backend/cloudbuild.yaml`

**Trigger:** Push to `main` with changes under `backend/**`

**Steps:**
1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. `docker build` — build Docker image
6. `docker push` — push to Artifact Registry
7. `gcloud run deploy` — deploy to Cloud Run (`asia-northeast1`)

### `frontend/cloudbuild.yaml`

**Trigger:** Push to `main` with changes under `frontend/**`

**Steps:**
1. `npm ci`
2. `npm run lint`
3. `npm test`
4. `npm run build` — with `VITE_` env vars hardcoded in the yaml
5. `firebase deploy --only hosting --project corgi-8732c`

VITE_ variables are hardcoded in the yaml (Firebase config is public-facing and commonly committed for client-side apps):
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_API_URL`

---

## Cloud Build Triggers (one-time setup via gcloud)

Two triggers connected to the `hokita/corgi` GitHub repo:

| Trigger | Branch | Path filter | Config file |
|---|---|---|---|
| `corgi-backend` | `main` | `backend/**` | `backend/cloudbuild.yaml` |
| `corgi-frontend` | `main` | `frontend/**` | `frontend/cloudbuild.yaml` |

---

## Service Account Permissions (one-time setup)

Cloud Build's built-in service account (`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`) needs these roles:

| Role | Why |
|---|---|
| `roles/run.admin` | Deploy to Cloud Run |
| `roles/artifactregistry.writer` | Push Docker images to Artifact Registry |
| `roles/iam.serviceAccountUser` | Act as Cloud Run's compute service account |
| `roles/firebasehosting.admin` | Deploy to Firebase Hosting |

Docker auth, gcloud auth, and Firebase CLI auth are handled automatically by Cloud Build.

---

## Files to Create

```
backend/
  cloudbuild.yaml
frontend/
  cloudbuild.yaml
```

## Files to Delete

```
.github/
  workflows/
    backend.yml
    frontend.yml
```

---

## Cleanup After Verification

Once Cloud Build deploys successfully end-to-end, remove:

**GitHub:**
- Secrets: `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `ALLOWED_EMAIL`
- Variables: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_API_URL`

**GCP:**
- Workload Identity Pool: `github-pool`
- Service account: `github-actions-deploy@corgi-8732c.iam.gserviceaccount.com`

---

## Constraints

- Node version: 24
- Docker image: `asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest`
- Cloud Run service: `corgi-backend`, region `asia-northeast1`, `--min-instances 0`, `--max-instances 2`, `--allow-unauthenticated`
- Cloud Run env vars: `FIREBASE_PROJECT_ID=corgi-8732c`, `FRONTEND_URL=https://corgi-8732c.web.app` (hardcoded — not sensitive)
- `ALLOWED_EMAIL` and `GEMINI_API_KEY` from Secret Manager via `--set-secrets` (sensitive values — not hardcoded)
- Firebase Hosting project: `corgi-8732c`
- Deploys only on `main` — no staging environment
