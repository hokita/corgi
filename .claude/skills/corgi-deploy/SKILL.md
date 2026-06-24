---
name: corgi-deploy
description: Use when deploying the corgi app — backend to Cloud Run or frontend to Firebase Hosting
---

# Corgi Deployment

**Project:** `corgi-8732c` | **Region:** `asia-northeast1`

---

## One-time setup: Store Gemini API key in Secret Manager

Run once — after this, deploys never need the key inline:

```bash
# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com

# Create the secret
echo -n "YOUR_GEMINI_KEY" | gcloud secrets create GEMINI_API_KEY \
  --data-file=- \
  --project=corgi-8732c

# Get the project number
gcloud projects describe corgi-8732c --format="value(projectNumber)"

# Grant Cloud Run's compute SA access to the secret
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=corgi-8732c
```

Replace `PROJECT_NUMBER` with the output of the `describe` command.

To update the key later:
```bash
echo -n "NEW_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
```

---

## Backend → Cloud Run

```bash
# 1. Pre-deployment checks
cd backend
npm run lint        # must pass with no errors
npm run format      # auto-fixes formatting
npm run build       # tsc — must compile cleanly
npm audit           # review vulnerabilities; fix if actionable

# 2. Build & push image
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest

# 3. Deploy
gcloud run deploy corgi-backend \
  --image asia-northeast1-docker.pkg.dev/corgi-8732c/corgi/backend:latest \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "ALLOWED_EMAIL=YOUR_EMAIL,FIREBASE_PROJECT_ID=corgi-8732c,FRONTEND_URL=https://corgi-8732c.web.app" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest"

# 4. Verify
curl https://YOUR_CLOUD_RUN_URL/health
# Expected: {"ok":true}
```

Replace `YOUR_EMAIL` with your Google account email.

---

## Frontend → Firebase Hosting

```bash
# 1. Pre-deployment checks
cd frontend
npm run lint        # must pass with no errors
npm run format      # auto-fixes formatting
npm run build       # tsc + vite — must compile cleanly
npm audit           # review vulnerabilities; fix if actionable
cd ..

# 2. Deploy
firebase deploy --only hosting
# Expected: Hosting URL: https://corgi-8732c.web.app
```

---

## Environment variables reference

| Variable | How set |
|---|---|
| `ALLOWED_EMAIL` | `--set-env-vars` on each deploy |
| `GEMINI_API_KEY` | Secret Manager via `--set-secrets` |
| `FIREBASE_PROJECT_ID` | `--set-env-vars` on each deploy |
| `FRONTEND_URL` | `--set-env-vars` on each deploy |
