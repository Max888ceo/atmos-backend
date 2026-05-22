const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

// Allow requests from your Atmos frontend
app.use(cors());
app.use(express.json());

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
  res.json({ status: 'ATMOS BACKEND ONLINE', version: '1.0.0' });
});

// ============================================
// NEWS ENDPOINT
// Fetches geopolitical news from GNews
// ============================================
app.get('/api/news', async (req, res) => {
  try {
    const query = req.query.q || 'geopolitical conflict war sanctions';
    const apiKey = process.env.GNEWS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GNEWS_API_KEY not configured' });
    }

    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=10&sortby=publishedAt&token=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.errors) {
      return res.status(400).json({ error: data.errors[0] });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// COT DATA ENDPOINT
// Fetches from CFTC Socrata API
// ============================================
app.get('/api/cot', async (req, res) => {
  try {
    const asset = req.query.asset || 'GOLD';
    const url = `https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$where=market_and_exchange_names LIKE '%25${encodeURIComponent(asset)}%25'&$order=report_date_as_yyyy_mm_dd DESC&$limit=2`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data || data.length === 0) {
      return res.status(404).json({ error: `No COT data found for ${asset}` });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CENTRAL BANK RATES ENDPOINT
// Fetches from exchangerate API + hardcoded meeting dates
// ============================================
app.get('/api/rates', async (req, res) => {
  try {
    // For now returns our accurate hardcoded data
    // In production connect to a rates API here
    const rates = {
      FED: { rate: 4.50, bias: "NEUTRAL", nextMeeting: "Jun 18, 2026", lastDecision: "HOLD" },
      ECB: { rate: 2.15, bias: "DOVISH", nextMeeting: "Jul 24, 2026", lastDecision: "HOLD" },
      BOE: { rate: 4.00, bias: "DOVISH", nextMeeting: "Aug 7, 2026", lastDecision: "CUT -25bp" },
      BOJ: { rate: 0.50, bias: "HAWKISH", nextMeeting: "Jul 31, 2026", lastDecision: "HOLD" },
      PBOC: { rate: 3.00, bias: "DOVISH", nextMeeting: "Aug 20, 2026", lastDecision: "HOLD" },
      RBA: { rate: 3.60, bias: "DOVISH", nextMeeting: "Jul 8, 2026", lastDecision: "CUT -25bp" },
    };
    res.json(rates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// POLITICIAN TRADES ENDPOINT
// Fetches from SEC EDGAR API (free, no key needed)
// ============================================
app.get('/api/politicians', async (req, res) => {
  try {
    // SEC EDGAR has a free API for Form 4 filings
    // This fetches recent insider trading disclosures
    const url = 'https://efts.sec.gov/LATEST/search-index?q=%22form+4%22&dateRange=custom&startdt=2026-01-01&enddt=2026-12-31&hits.hits._source=period_of_report,entity_name,file_num&hits.hits.total.value=true';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Atmos Intelligence contact@atmos.finance' }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ATMOS BACKEND running on port ${PORT}`);
});
