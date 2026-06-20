# corgi

Personal AI chat app backed by Gemini, built on GCP and Firebase.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS v4, Firebase Auth |
| Backend | Node.js 24, Express, TypeScript |
| AI | Gemini 2.5 Flash Lite (`@google/generative-ai`) |
| Storage | Firestore (conversation history) |
| Hosting | Firebase Hosting (frontend) + Cloud Run (backend) |

## Project structure

```
corgi/
├── frontend/   # React PWA
└── backend/    # Express API
```

## Local development

**Backend**

```sh
cd backend
cp .env.example .env   # fill in values
npm install
npm run dev            # starts on :3000
```

**Frontend**

```sh
cd frontend
npm install
npm run dev            # starts on :5173
```

## Tests

```sh
cd backend && npm test
cd frontend && npm test
```

21 tests total (17 backend, 4 frontend).

## Deploy

See [`docs/deploy-task15.md`](docs/deploy-task15.md) for Cloud Run deployment steps.

Frontend deploys to Firebase Hosting via `firebase deploy`.

## Environment variables (backend)

| Variable | Description |
|---|---|
| `ALLOWED_EMAIL` | Google account allowed to use the app |
| `GEMINI_API_KEY` | Gemini API key from Google AI Studio |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FRONTEND_URL` | Frontend origin for CORS |
