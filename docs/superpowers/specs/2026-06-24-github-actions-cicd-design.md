# GitHub Actions CI/CD Design

**Date:** 2026-06-24
**Project:** corgi (`corgi-8732c`)

---

## Overview

Two separate GitHub Actions workflows deploy the backend and frontend independently when their respective directories change on the `main` branch. Authentication to GCP uses Workload Identity Federation (WIF) — no static credentials stored anywhere.

---

## Workflow Structure

### `backend.yml`

**Trigger:** Push to `main` with changes under `backend/**`

**Steps:**
1. Checkout code
2. Setup Node.js 24
3. `npm ci`
4. `npm run lint` — fail fast on lint errors
5. `npm test` — run Vitest tests
6. `npm run build` — compile TypeScript
7. Authenticate to GCP via WIF (`google-github-actions/auth@v2`)
8. `gcloud builds submit` — build and push Docker image to Artifact Registry
9. `gcloud run deploy` — deploy to Cloud Run (`asia-northeast1`)

### `frontend.yml`

**Trigger:** Push to `main` with changes under `frontend/**`

**Steps:**
1. Checkout code
2. Setup Node.js 24
3. `npm ci`
4. `npm run lint`
5. `npm test`
6. `npm run build` — `tsc && vite build`
7. Authenticate to GCP via WIF (`google-github-actions/auth@v2`)
8. `firebase deploy --only hosting`

---

## Workload Identity Federation Setup (one-time, manual)

Run these commands once before the first deploy. Replace values in `<angle brackets>`.

```bash
# 1. Enable required APIs
gcloud services enable iamcredentials.googleapis.com \
  --project=corgi-8732c

# 2. Create Workload Identity Pool
gcloud iam workload-identity-pools create "github-pool" \
  --project=corgi-8732c \
  --location="global" \
  --display-name="GitHub Actions Pool"

# 3. Create GitHub OIDC Provider inside the pool
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project=corgi-8732c \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 4. Create service account
gcloud iam service-accounts create "github-actions-deploy" \
  --project=corgi-8732c \
  --display-name="GitHub Actions Deploy"

# 5. Grant required roles to the service account
gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --role="roles/firebasehosting.admin"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

# 6. Allow the WIF pool to impersonate the service account,
#    scoped to only the hokita/corgi repository
gcloud iam service-accounts add-iam-policy-binding \
  "github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --project=corgi-8732c \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe corgi-8732c --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-pool/attribute.repository/hokita/corgi"

# 7. Output the WIF provider resource name (paste into GitHub Secret: WIF_PROVIDER)
echo "WIF_PROVIDER:"
echo "projects/$(gcloud projects describe corgi-8732c --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-pool/providers/github-provider"

# 8. Output the service account email (paste into GitHub Secret: WIF_SERVICE_ACCOUNT)
echo "WIF_SERVICE_ACCOUNT:"
echo "github-actions-deploy@corgi-8732c.iam.gserviceaccount.com"
```

---

## GitHub Secrets

| Secret | Value |
|---|---|
| `WIF_PROVIDER` | Output from step 7 above |
| `WIF_SERVICE_ACCOUNT` | `github-actions-deploy@corgi-8732c.iam.gserviceaccount.com` |
| `ALLOWED_EMAIL` | Your Google account email (used as Cloud Run env var) |

Set these at: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

---

## Environment Variables (Cloud Run)

These are passed inline on each deploy (same as the manual deploy skill):

| Variable | Value |
|---|---|
| `ALLOWED_EMAIL` | From `${{ secrets.ALLOWED_EMAIL }}` |
| `FIREBASE_PROJECT_ID` | `corgi-8732c` (hardcoded in workflow) |
| `FRONTEND_URL` | `https://corgi-8732c.web.app` (hardcoded in workflow) |
| `GEMINI_API_KEY` | From Secret Manager via `--set-secrets` (already set up) |

---

## Files to Create

```
.github/
  workflows/
    backend.yml
    frontend.yml
```

---

## Constraints

- Both workflows use `actions/checkout@v4`, `actions/setup-node@v4`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`
- Firebase CLI installed via `npm install -g firebase-tools` in the frontend workflow
- Node version: 24 (matches Dockerfile)
- Deploys only run on `main` — no staging environment
