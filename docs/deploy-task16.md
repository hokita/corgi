# Task 16: Deploy Frontend to Firebase Hosting

Project: `corgi-8732c`
Hosting URL: `https://corgi-8732c.web.app`

Firebase CLI login does not work locally — deploy from **Google Cloud Shell** instead.
Cloud Shell is pre-authenticated with your Google account; no `firebase login` needed.

---

## Step 1: Create Firebase config files ✅

`firebase.json` and `.firebaserc` have been added to the repo root.

- `firebase.json` — points public dir to `frontend/dist`, rewrites all routes to `index.html` for SPA routing
- `.firebaserc` — sets default project to `corgi-8732c`

---

## Step 2: Push the config files to GitHub

```bash
git add firebase.json .firebaserc
git commit -m "feat: add Firebase Hosting config"
git push
```

---

## Step 3: Open Cloud Shell

1. Go to https://console.firebase.google.com
2. Click the **Cloud Shell** icon (`>_`) in the top-right toolbar

---

## Step 4: Clone the repo in Cloud Shell

```bash
git clone https://github.com/hokita/corgi.git
cd corgi
```

If already cloned:

```bash
cd corgi && git pull
```

---

## Step 5: Build the frontend

```bash
cd frontend && npm install && npm run build && cd ..
```

The build output lands in `frontend/dist/`.

---

## Step 6: Deploy to Firebase Hosting

```bash
firebase deploy --only hosting
```

Expected output ends with:

```
✔  Deploy complete!

Hosting URL: https://corgi-8732c.web.app
```

---

## Step 7: Verify

Open https://corgi-8732c.web.app in a browser and confirm the login page loads.

---

Task 16 is complete once the app is accessible at the hosting URL.
