# GitHub Actions CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up two GitHub Actions workflows that lint, test, build, and deploy the backend (Cloud Run) and frontend (Firebase Hosting) independently on push to `main`, authenticated via Workload Identity Federation.

**Architecture:** Two separate workflow files triggered by path-based filters — `backend/**` triggers `backend.yml`, `frontend/**` triggers `frontend.yml`. Both use `google-github-actions/auth@v2` for keyless GCP authentication via WIF. WIF is configured once manually via `gcloud` CLI before workflows are created.

**Tech Stack:** GitHub Actions, Workload Identity Federation, Cloud Run, Artifact Registry, Cloud Build, Firebase Hosting, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`, `actions/setup-node@v4`

## Global Constraints

- GCP project: `corgi-8732c`, region: `asia-northeast1`
- Node version: 24 (matches Dockerfile)
- Deploys only on push to `main` — no staging environment
- `GEMINI_API_KEY` already exists in Secret Manager — do not recreate it
- All workflow actions pinned to specific major versions: `@v4`, `@v2`

---

### Task 1: Workload Identity Federation setup and GitHub Secrets

**Files:**
- No files created — this is manual `gcloud` CLI steps run by the user

**Interfaces:**
- Produces: `WIF_PROVIDER` secret value, `WIF_SERVICE_ACCOUNT` secret value, set in GitHub repo secrets

- [ ] **Step 1: Enable the IAM Credentials API**

Run in your terminal (you must be authenticated as the project owner):

```bash
gcloud services enable iamcredentials.googleapis.com --project=corgi-8732c
```

Expected: `Operation "operations/..." finished successfully.`

- [ ] **Step 2: Create the Workload Identity Pool**

```bash
gcloud iam workload-identity-pools create "github-pool" \
  --project=corgi-8732c \
  --location="global" \
  --display-name="GitHub Actions Pool"
```

Expected: `Created workload identity pool [github-pool].`

- [ ] **Step 3: Create the GitHub OIDC Provider inside the pool**

```bash
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project=corgi-8732c \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --attribute-condition="attribute.repository == 'hokita/corgi'" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

Expected: `Created workload identity pool provider [github-provider].`

- [ ] **Step 4: Create the service account**

```bash
gcloud iam service-accounts create "github-actions-deploy" \
  --project=corgi-8732c \
  --display-name="GitHub Actions Deploy"
```

Expected: `Created service account [github-actions-deploy].`

- [ ] **Step 5: Grant required roles to the service account**

Run each command. Expected for each: `Updated IAM policy for project [corgi-8732c].`

```bash
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
```

- [ ] **Step 6: Bind the service account to WIF, scoped to hokita/corgi only**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "github-actions-deploy@corgi-8732c.iam.gserviceaccount.com" \
  --project=corgi-8732c \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe corgi-8732c --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-pool/attribute.repository/hokita/corgi"
```

Expected: `Updated IAM policy for service account [github-actions-deploy@corgi-8732c.iam.gserviceaccount.com].`

- [ ] **Step 7: Get the values for GitHub Secrets**

```bash
echo "WIF_PROVIDER value:"
echo "projects/$(gcloud projects describe corgi-8732c --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-pool/providers/github-provider"

echo ""
echo "WIF_SERVICE_ACCOUNT value:"
echo "github-actions-deploy@corgi-8732c.iam.gserviceaccount.com"
```

Copy both output values — you'll need them in the next step.

- [ ] **Step 8: Add the three secrets to GitHub**

Go to: **https://github.com/hokita/corgi/settings/secrets/actions**

Add three repository secrets:

| Secret name | Value |
|---|---|
| `WIF_PROVIDER` | The `projects/…/providers/github-provider` string from step 7 |
| `WIF_SERVICE_ACCOUNT` | `github-actions-deploy@corgi-8732c.iam.gserviceaccount.com` |
| `ALLOWED_EMAIL` | Your Google account email (e.g. `hideee.0202@gmail.com`) |

---

### Task 2: Create backend deployment workflow

**Files:**
- Create: `.github/workflows/backend.yml`

**Interfaces:**
- Consumes: `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `ALLOWED_EMAIL` GitHub secrets (from Task 1)
- Produces: Working `backend.yml` workflow that lints, tests, builds, and deploys backend on push to `main` when `backend/**` changes

- [ ] **Step 1: Create the .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/backend.yml`**

```yaml
name: Deploy Backend

on:
  push:
    branches:
      - main
    paths:
      - 'backend/**'

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
        working-directory: backend
        run: npm ci

      - name: Lint
        working-directory: backend
        run: npm run lint

      - name: Test
        working-directory: backend
        run: npm test

      - name: Build
        working-directory: backend
        run: npm run build

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Build and push Docker image
        run: |
          gcloud builds submit backend/ \
            --tag asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy corgi-backend \
            --image asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest \
            --region asia-northeast1 \
            --allow-unauthenticated \
            --min-instances 0 \
            --max-instances 2 \
            --set-env-vars "ALLOWED_EMAIL=${{ secrets.ALLOWED_EMAIL }},FIREBASE_PROJECT_ID=corgi-8732c,FRONTEND_URL=https://corgi-8732c.web.app" \
            --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

- [ ] **Step 3: Validate the YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/backend.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/backend.yml
git commit -m "ci: add backend deployment workflow via WIF"
```

- [ ] **Step 5: Verify the workflow appears in GitHub**

Push to `main`:

```bash
git push origin main
```

Go to **https://github.com/hokita/corgi/actions** — you should see the `Deploy Backend` workflow listed (it will only run when `backend/**` files change).

---

### Task 3: Create frontend deployment workflow

**Files:**
- Create: `.github/workflows/frontend.yml`

**Interfaces:**
- Consumes: `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT` GitHub secrets (from Task 1)
- Produces: Working `frontend.yml` workflow that lints, tests, builds, and deploys frontend on push to `main` when `frontend/**` changes

- [ ] **Step 1: Create `.github/workflows/frontend.yml`**

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

- [ ] **Step 2: Validate the YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/frontend.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/frontend.yml
git commit -m "ci: add frontend deployment workflow via WIF"
```

- [ ] **Step 4: Verify the workflow appears in GitHub**

```bash
git push origin main
```

Go to **https://github.com/hokita/corgi/actions** — you should see both `Deploy Backend` and `Deploy Frontend` listed.

- [ ] **Step 5: Trigger a test deploy**

Make a trivial change to a frontend file (e.g. add a blank line to `frontend/src/main.tsx`), commit, and push to `main`:

```bash
echo "" >> frontend/src/main.tsx
git add frontend/src/main.tsx
git commit -m "test: trigger frontend workflow"
git push origin main
```

Go to **https://github.com/hokita/corgi/actions** and watch the `Deploy Frontend` workflow run. Expected: all steps green, deploy succeeds, https://corgi-8732c.web.app loads correctly.

Revert the trivial change after confirming:

```bash
git revert HEAD --no-edit
git push origin main
```
