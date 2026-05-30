const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
  res.json({ status: 'ATMOS BACKEND ONLINE', version: '2.0.0' });
});

// ============================================
// COT DATA ENDPOINT
// Source: CFTC Disaggregated Futures Only (72hh-3qpy)
// Supports: GOLD, SILVER, CRUDE OIL, EURO, NASDAQ, S&P 500, etc.
//
// Asset name map — CFTC uses specific strings in market_and_exchange_names
// We map short tickers to CFTC search terms
// ============================================

const COT_ASSET_MAP = {
  'GOLD':     'GOLD',
  'SILVER':   'SILVER',
  'OIL':      'CRUDE OIL',
  'CRUDE':    'CRUDE OIL',
  'WTI':      'CRUDE OIL, LIGHT SWEET',
  'EURO':     'EURO FX',
  'EUR':      'EURO FX',
  'JPY':      'JAPANESE YEN',
  'GBP':      'BRITISH POUND',
  'AUD':      'AUSTRALIAN DOLLAR',
  'CAD':      'CANADIAN DOLLAR',
  'CHF':      'SWISS FRANC',
  'COPPER':   'COPPER',
  'NATGAS':   'NATURAL GAS',
  'GAS':      'NATURAL GAS',
  'WHEAT':    'WHEAT',
  'CORN':     'CORN',
  'SOYBEANS': 'SOYBEANS',
  'BTC':      'BITCOIN',
};

// Derive sentiment from non-commercial net positioning + week-over-week change
function calcSentiment(ncLong, ncShort, prevNcLong, prevNcShort) {
  const netNow  = ncLong  - ncShort;
  const netPrev = prevNcLong - prevNcShort;
  const change  = netNow - netPrev;

  // Strong signal: net > 0 and increasing = BULLISH
  // Strong signal: net < 0 and decreasing = BEARISH
  // Otherwise: NEUTRAL
  if (netNow > 0 && change > 0)  return 'BULLISH';
  if (netNow < 0 && change < 0)  return 'BEARISH';
  if (netNow > 0 && change <= 0) return 'BULLISH'; // still net long, just fading
  if (netNow < 0 && change >= 0) return 'BEARISH'; // still net short, just fading
  return 'NEUTRAL';
}

// Normalize strength to 0-100 based on net positioning magnitude
function calcStrength(ncLong, ncShort) {
  const net   = Math.abs(ncLong - ncShort);
  const total = ncLong + ncShort;
  if (total === 0) return 50;
  return Math.min(100, Math.round((net / total) * 100));
}

app.get('/api/cot', async (req, res) => {
  try {
    const assetParam = (req.query.asset || 'GOLD').toUpperCase();
    const searchTerm = COT_ASSET_MAP[assetParam] || assetParam;

    // Fetch 2 most recent weeks so we can calc WoW change
    const url = `https://publicreporting.cftc.gov/resource/72hh-3qpy.json` +
      `?$where=market_and_exchange_names LIKE '%25${encodeURIComponent(searchTerm)}%25'` +
      `&$order=report_date_as_yyyy_mm_dd DESC` +
      `&$limit=2`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Atmos Intelligence contact@atmos.finance' }
    });

    if (!response.ok) {
      return res.status(502).json({ error: `CFTC API returned ${response.status}` });
    }

    const rows = await response.json();

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: `No COT data found for: ${searchTerm}` });
    }

    const curr = rows[0];
    const prev = rows[1] || rows[0]; // fallback to same row if only 1 result

    // Parse key fields — all come as strings from Socrata
    const parse = (v) => parseInt(v || '0', 10);

    const ncLong      = parse(curr.noncomm_positions_long_all);
    const ncShort     = parse(curr.noncomm_positions_short_all);
    const commLong    = parse(curr.comm_positions_long_all);
    const commShort   = parse(curr.comm_positions_short_all);
    const openInt     = parse(curr.open_interest_all);

    const prevNcLong  = parse(prev.noncomm_positions_long_all);
    const prevNcShort = parse(prev.noncomm_positions_short_all);

    const ncNet       = ncLong - ncShort;
    const commNet     = commLong - commShort;
    const ncNetChange = ncNet - (prevNcLong - prevNcShort);

    const sentiment = calcSentiment(ncLong, ncShort, prevNcLong, prevNcShort);
    const strength  = calcStrength(ncLong, ncShort);

    res.json({
      asset:        assetParam,
      market:       curr.market_and_exchange_names,
      reportDate:   curr.report_date_as_yyyy_mm_dd,
      prevDate:     prev.report_date_as_yyyy_mm_dd,
      openInterest: openInt,

      // Non-Commercial (speculators / hedge funds) — the signal
      nonCommercial: {
        long:      ncLong,
        short:     ncShort,
        net:       ncNet,
        netChange: ncNetChange,       // positive = bulls adding, negative = shorts adding
        spreading: parse(curr.noncomm_postions_spread_all),
      },

      // Commercial (hedgers) — inverse indicator
      commercial: {
        long:  commLong,
        short: commShort,
        net:   commNet,
      },

      // Derived signal for Atmos UI
      signal: {
        sentiment,  // BULLISH | BEARISH | NEUTRAL
        strength,   // 0–100
        detail: `Non-commercial net ${ncNet > 0 ? '+' : ''}${ncNet.toLocaleString()} contracts. ` +
                `WoW change: ${ncNetChange > 0 ? '+' : ''}${ncNetChange.toLocaleString()}. ` +
                `Open interest: ${openInt.toLocaleString()}.`,
      },
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// NEWS ENDPOINT
// Fetches geopolitical news from GNews
// ============================================
app.get('/api/news', async (req, res) => {
  try {
    const query  = req.query.q || 'geopolitical conflict war sanctions';
    const apiKey = process.env.GNEWS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GNEWS_API_KEY not configured' });
    }

    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=10&sortby=publishedAt&token=${apiKey}`;
    const response = await fetch(url);
    const data     = await response.json();

    if (data.errors) {
      return res.status(400).json({ error: data.errors[0] });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CENTRAL BANK RATES ENDPOINT
// Hardcoded for now — accurate as of May 2026
// ============================================
app.get('/api/rates', async (req, res) => {
  try {
    const rates = {
      FED:  { rate: 4.50, bias: 'NEUTRAL', nextMeeting: 'Jun 18, 2026', lastDecision: 'HOLD' },
      ECB:  { rate: 2.15, bias: 'DOVISH',  nextMeeting: 'Jul 24, 2026', lastDecision: 'HOLD' },
      BOE:  { rate: 4.00, bias: 'DOVISH',  nextMeeting: 'Aug 7, 2026',  lastDecision: 'CUT -25bp' },
      BOJ:  { rate: 0.50, bias: 'HAWKISH', nextMeeting: 'Jul 31, 2026', lastDecision: 'HOLD' },
      PBOC: { rate: 3.00, bias: 'DOVISH',  nextMeeting: 'Aug 20, 2026', lastDecision: 'HOLD' },
      RBA:  { rate: 3.60, bias: 'DOVISH',  nextMeeting: 'Jul 8, 2026',  lastDecision: 'CUT -25bp' },
    };
    res.json(rates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// POLITICIAN TRADES ENDPOINT
// Source: SEC EDGAR Form 4 filings
// ============================================
app.get('/api/politicians', async (req, res) => {
  try {
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
  console.log(`ATMOS BACKEND v2.0.0 running on port ${PORT}`);
});
