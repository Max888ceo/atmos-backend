# ATMOS BACKEND

Node.js/Express backend for Atmos Macro Intelligence Terminal.

## ENDPOINTS

- GET / — Health check
- GET /api/news?q=query — Fetch geopolitical news (GNews)
- GET /api/cot?asset=GOLD — Fetch live CFTC COT data
- GET /api/rates — Fetch central bank rates
- GET /api/politicians — Fetch SEC filings

## DEPLOY TO RAILWAY

1. Push this folder to GitHub
2. Go to railway.app
3. Click "New Project" → "Deploy from GitHub"
4. Select this repo
5. Add environment variables:
   - GNEWS_API_KEY = your gnews api key
6. Deploy — Railway gives you a live URL

## LOCAL DEVELOPMENT

```
npm install
node server.js
```

Server runs on http://localhost:3001
