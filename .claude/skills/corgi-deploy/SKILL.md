---
name: corgi-deploy
description: Use when deploying the corgi app — backend to Cloud Run or frontend to Firebase Hosting
---

# Corgi Deployment

**Project:** `corgi-8732c` | **Region:** `asia-northeast1`

Deployment is fully automated via GitHub Actions on push to `main`.
**Never run `gcloud` or `firebase` deploy commands manually.**

---

## Backend → Cloud Run

Triggered automatically when any file under `backend/` changes on `main`.

```bash
# 1. Pre-push checks (mirror what CI will run — catch failures locally first)
cd backend
npm run lint        # must pass with no errors
npm test            # all tests must pass
npm run build       # tsc — must compile cleanly
cd ..

# 2. Commit and push
git add backend/...
git commit -m "..."
git push

# 3. Watch the GitHub Actions deploy run
gh run watch   # streams the active run; Ctrl-C when done
```

After the run succeeds, verify the backend is live:
```bash
curl https://corgi-backend-838648453884.asia-northeast1.run.app/health
# Expected: {"ok":true}
```

---

## Frontend → Firebase Hosting

Triggered automatically when files under `frontend/`, `firebase.json`, `.firebaserc`, or `.github/workflows/frontend.yml` change on `main`.

```bash
# 1. Pre-push checks
cd frontend
npm run lint        # must pass with no errors
npm test            # all tests must pass
npm run build       # tsc + vite — must compile cleanly
cd ..

# 2. Commit and push
git add frontend/...
git commit -m "..."
git push

# 3. Watch the GitHub Actions deploy run
gh run watch
```

After the run succeeds, the frontend is live at: `https://corgi-8732c.web.app`

---

## Environment variables reference

| Variable | Where set |
|---|---|
| `ALLOWED_EMAIL` | Secret Manager (`ALLOWED_EMAIL:latest`) |
| `GEMINI_API_KEY` | Secret Manager (`GEMINI_API_KEY:latest`) |
| `FIREBASE_PROJECT_ID` | Hardcoded in workflow (`corgi-8732c`) |
| `FRONTEND_URL` | Hardcoded in workflow (`https://corgi-8732c.web.app`) |
| `GOOGLE_SEARCH_ENABLED` | Hardcoded in workflow (`true`) |
| `VITE_API_URL` | Hardcoded in frontend workflow |
