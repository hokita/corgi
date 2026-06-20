# Task 15: Deploy Backend to Cloud Run

Project: `corgi-8732c`
Region: `asia-northeast1`
Image: `asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest`

Steps 1 and 2 are already done. Continuing from Step 3.

---

## Step 1: Enable required GCP APIs ✅

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

---

## Step 2: Create Artifact Registry repository ✅

```bash
gcloud artifacts repositories create corgi \
  --repository-format=docker \
  --location=asia-northeast1
```

---

## Step 3: Build and push Docker image via Cloud Build

```bash
cd backend
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest
```

---

## Step 4: Deploy to Cloud Run

Replace the placeholder values before running:
- `YOUR_GEMINI_KEY` — your Gemini API key from https://aistudio.google.com/apikey

```bash
gcloud run deploy corgi-backend \
  --image asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "ALLOWED_EMAIL=YOUR_EMAIL,GEMINI_API_KEY=YOUR_GEMINI_KEY,FIREBASE_PROJECT_ID=corgi-8732c,FRONTEND_URL=https://corgi-8732c.web.app"
```

The command will print a **Service URL** when done — copy it, you'll need it for Task 16.

---

## Step 5: Verify the health check

```bash
curl https://YOUR_CLOUD_RUN_URL/health
```

Expected response: `{"ok":true}`

---

## Step 6: Commit (nothing to stage — no files changed)

Task 15 is complete once the health check passes.
