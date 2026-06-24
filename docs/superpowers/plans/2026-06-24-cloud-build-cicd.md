# Cloud Build CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub Actions workflows with Cloud Build triggers for automatic CI/CD on push to `main`.

**Architecture:** Two `cloudbuild.yaml` files (one per service) define lint→test→build→deploy pipelines triggered by path-based filters on `main`. Cloud Build's built-in service account handles all GCP auth — no WIF or custom service account needed.

**Tech Stack:** Google Cloud Build, Cloud Run, Artifact Registry, Firebase Hosting, Node.js 24, Docker

## Global Constraints

- GCP project: `corgi-8732c`, region: `asia-northeast1`
- Node version: 24
- Docker image: `asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest`
- Cloud Run service: `corgi-backend`, `--min-instances=0`, `--max-instances=2`, `--allow-unauthenticated`
- `ALLOWED_EMAIL` and `GEMINI_API_KEY` from Secret Manager via `--set-secrets` (not hardcoded)
- `FIREBASE_PROJECT_ID=corgi-8732c` and `FRONTEND_URL=https://corgi-8732c.web.app` hardcoded in yaml
- Firebase Hosting project: `corgi-8732c`
- VITE_ Firebase config values hardcoded in `frontend/cloudbuild.yaml` (public, non-sensitive)
- Deploys only on `main` — no staging environment

---

### Task 1: GCP one-time setup

**Files:** None — manual `gcloud` CLI steps run by the user

**Interfaces:**
- Produces: Cloud Build SA has required roles; `ALLOWED_EMAIL` stored in Secret Manager; Cloud Run compute SA can access it

- [ ] **Step 1: Get the Cloud Build service account email**

```bash
PROJECT_NUMBER=$(gcloud projects describe corgi-8732c --format='value(projectNumber)')
echo "Cloud Build SA: ${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
```

Note the project number — used in all subsequent steps.

- [ ] **Step 2: Grant required roles to the Cloud Build SA**

```bash
PROJECT_NUMBER=$(gcloud projects describe corgi-8732c --format='value(projectNumber)')
SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:${SA}" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:${SA}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:${SA}" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding corgi-8732c \
  --member="serviceAccount:${SA}" \
  --role="roles/firebasehosting.admin"
```

Expected for each: `Updated IAM policy for project [corgi-8732c].`

- [ ] **Step 3: Store ALLOWED_EMAIL in Secret Manager**

```bash
echo -n "YOUR_GOOGLE_EMAIL" | gcloud secrets create ALLOWED_EMAIL \
  --data-file=- \
  --project=corgi-8732c
```

Replace `YOUR_GOOGLE_EMAIL` with your Google account email. Expected: `Created secret [ALLOWED_EMAIL].`

- [ ] **Step 4: Grant Cloud Run compute SA access to ALLOWED_EMAIL**

```bash
PROJECT_NUMBER=$(gcloud projects describe corgi-8732c --format='value(projectNumber)')

gcloud secrets add-iam-policy-binding ALLOWED_EMAIL \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=corgi-8732c
```

Expected: `Updated IAM policy for secret [ALLOWED_EMAIL].`

---

### Task 2: Create backend/cloudbuild.yaml

**Files:**
- Create: `backend/cloudbuild.yaml`

**Interfaces:**
- Consumes: Cloud Build SA roles from Task 1; `ALLOWED_EMAIL` and `GEMINI_API_KEY` in Secret Manager
- Produces: `backend/cloudbuild.yaml` committed to repo

- [ ] **Step 1: Create `backend/cloudbuild.yaml`**

```yaml
steps:
  - name: 'node:24'
    entrypoint: 'npm'
    args: ['ci']
    dir: 'backend'

  - name: 'node:24'
    entrypoint: 'npm'
    args: ['run', 'lint']
    dir: 'backend'

  - name: 'node:24'
    entrypoint: 'npm'
    args: ['test']
    dir: 'backend'

  - name: 'node:24'
    entrypoint: 'npm'
    args: ['run', 'build']
    dir: 'backend'

  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '-t'
      - 'asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest'
      - 'backend/'

  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'push'
      - 'asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    args:
      - 'gcloud'
      - 'run'
      - 'deploy'
      - 'corgi-backend'
      - '--image=asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest'
      - '--region=asia-northeast1'
      - '--allow-unauthenticated'
      - '--min-instances=0'
      - '--max-instances=2'
      - '--set-env-vars=FIREBASE_PROJECT_ID=corgi-8732c,FRONTEND_URL=https://corgi-8732c.web.app'
      - '--set-secrets=ALLOWED_EMAIL=ALLOWED_EMAIL:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest'
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('backend/cloudbuild.yaml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add backend/cloudbuild.yaml
git commit -m "ci: add Cloud Build pipeline for backend"
```

---

### Task 3: Create frontend/cloudbuild.yaml

**Files:**
- Create: `frontend/cloudbuild.yaml`

**Interfaces:**
- Consumes: Cloud Build SA roles from Task 1
- Produces: `frontend/cloudbuild.yaml` committed and pushed to repo

- [ ] **Step 1: Create `frontend/cloudbuild.yaml`**

```yaml
steps:
  - name: 'node:24'
    entrypoint: 'npm'
    args: ['ci']
    dir: 'frontend'

  - name: 'node:24'
    entrypoint: 'npm'
    args: ['run', 'lint']
    dir: 'frontend'

  - name: 'node:24'
    entrypoint: 'npm'
    args: ['test']
    dir: 'frontend'

  - name: 'node:24'
    entrypoint: 'npm'
    args: ['run', 'build']
    dir: 'frontend'
    env:
      - 'VITE_FIREBASE_API_KEY=AIzaSyCwAA7MJGTsn6wNMsJrPwSj_Lt3d4Sx2Ho'
      - 'VITE_FIREBASE_AUTH_DOMAIN=corgi-8732c.firebaseapp.com'
      - 'VITE_FIREBASE_PROJECT_ID=corgi-8732c'
      - 'VITE_API_URL=https://corgi-backend-838648453884.asia-northeast1.run.app'

  - name: 'node:24'
    entrypoint: 'bash'
    args:
      - '-c'
      - 'npm install -g firebase-tools && firebase deploy --only hosting --project corgi-8732c'
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('frontend/cloudbuild.yaml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit and push**

```bash
git add frontend/cloudbuild.yaml
git commit -m "ci: add Cloud Build pipeline for frontend"
git push origin main
```

Push is required before creating triggers in Task 4 so Cloud Build can find the config files in the repo.

---

### Task 4: Connect GitHub repo and create Cloud Build triggers

**Files:** None — manual steps in GCP Console + gcloud

**Interfaces:**
- Consumes: `backend/cloudbuild.yaml` and `frontend/cloudbuild.yaml` in `main` (from Tasks 2-3)
- Produces: Two active Cloud Build triggers watching `main`

- [ ] **Step 1: Connect GitHub repo to Cloud Build (Console UI)**

Go to: **https://console.cloud.google.com/cloud-build/triggers?project=corgi-8732c**

Click **Connect Repository** → select **GitHub** → authorize Cloud Build → select `hokita/corgi` → click **Connect**.

This is a one-time step. Without it the gcloud trigger commands in the next steps will fail.

- [ ] **Step 2: Create the backend trigger**

```bash
gcloud builds triggers create github \
  --name="corgi-backend" \
  --repo-name="corgi" \
  --repo-owner="hokita" \
  --branch-pattern="^main$" \
  --build-config="backend/cloudbuild.yaml" \
  --included-files="backend/**" \
  --project=corgi-8732c
```

Expected: `Created [https://cloudbuild.googleapis.com/v1/projects/corgi-8732c/triggers/...]`

- [ ] **Step 3: Create the frontend trigger**

```bash
gcloud builds triggers create github \
  --name="corgi-frontend" \
  --repo-name="corgi" \
  --repo-owner="hokita" \
  --branch-pattern="^main$" \
  --build-config="frontend/cloudbuild.yaml" \
  --included-files="frontend/**" \
  --project=corgi-8732c
```

Expected: `Created [https://cloudbuild.googleapis.com/v1/projects/corgi-8732c/triggers/...]`

- [ ] **Step 4: Verify both triggers appear in GCP Console**

Go to: **https://console.cloud.google.com/cloud-build/triggers?project=corgi-8732c**

You should see `corgi-backend` and `corgi-frontend` listed and enabled.

- [ ] **Step 5: Test the backend trigger**

```bash
echo "" >> backend/src/index.ts
git add backend/src/index.ts
git commit -m "test: trigger backend Cloud Build"
git push origin main
```

Watch the build at: **https://console.cloud.google.com/cloud-build/builds?project=corgi-8732c**

Expected: all steps green, Cloud Run deploys successfully.

- [ ] **Step 6: Revert the backend test commit**

```bash
git revert HEAD --no-edit
git push origin main
```

- [ ] **Step 7: Test the frontend trigger**

```bash
echo "" >> frontend/src/main.tsx
git add frontend/src/main.tsx
git commit -m "test: trigger frontend Cloud Build"
git push origin main
```

Watch at: **https://console.cloud.google.com/cloud-build/builds?project=corgi-8732c**

Expected: all steps green, Firebase Hosting deploys successfully, https://corgi-8732c.web.app loads correctly.

- [ ] **Step 8: Revert the frontend test commit**

```bash
git revert HEAD --no-edit
git push origin main
```

---

### Task 5: Delete GitHub Actions workflows

**Files:**
- Delete: `.github/workflows/backend.yml`
- Delete: `.github/workflows/frontend.yml`

**Interfaces:**
- Consumes: Working Cloud Build triggers confirmed in Task 4
- Produces: Clean repo with no GitHub Actions workflows

- [ ] **Step 1: Delete the workflow files and commit**

```bash
git rm .github/workflows/backend.yml .github/workflows/frontend.yml
git commit -m "ci: remove GitHub Actions workflows — replaced by Cloud Build"
git push origin main
```

Expected: `rm '.github/workflows/backend.yml'` and `rm '.github/workflows/frontend.yml'`

- [ ] **Step 2: Verify no workflows in GitHub**

Go to: **https://github.com/hokita/corgi/actions**

No active workflows should be listed.
