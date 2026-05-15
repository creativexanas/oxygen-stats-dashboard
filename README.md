# Oxygen Stats Dashboard

Live Arabic admin dashboard for Oxygen app usage analytics.

The Firebase Admin credential is never shipped to the browser. GitHub Actions reads it from the `FIREBASE_SERVICE_ACCOUNT` repository secret, generates `dist/data/stats.json`, and deploys the static dashboard to GitHub Pages.

## Local Build

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json npm run build
```

## Deploy

Push to `main`, run the Pages workflow manually, or wait for the scheduled workflow.
