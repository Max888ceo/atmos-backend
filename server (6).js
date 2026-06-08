const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
  res.json({ status: 'ATMOS BACKEND ONLINE', version: '2.2.0' });
});

// ============================================
// COT DATA ENDPOINT
// Source: CFTC Legacy Futures Only (6dca-aqww)
// ============================================
const COT_ASSET_MAP = {
  'GOLD':     'GOLD',
  'SILVER':   'SILVER',
  'OIL':      'CRUDE OIL, LIGHT SWEET',
  'CRUDE':    'CRUDE OIL, LIGHT SWEET',
  'WTI':      'CRUDE OIL, LIGHT SWEET',
  'EURO':     'EURO FX - CHICAGO MERCANTILE EXCHANGE',
  'EUR':      'EURO FX - CHICAGO MERCANTILE EXCHANGE',
  'JPY':      'JAPANESE YEN',
  'GBP':      'BRITISH POUND',
  'AUD':      'AUSTRALIAN DOLLAR',
  'CAD':      'CANADIAN DOLLAR',
  'CHF':      'SWISS FRANC',
  'COPPER':   'COPPER-GRADE #1',
  'NATGAS':   'NATURAL GAS - NEW YORK MERCANTILE EXCHANGE',
  'GAS':      'NATURAL GAS - NEW YORK MERCANTILE EXCHANGE',
  'WHEAT':    'WHEAT',
  'CORN':     'CORN',
  'SOYBEANS': 'SOYBEANS',
  'BTC':      'BITCOIN',
  'NASDAQ':   'E-MINI NASDAQ-100',
  'SP500':    'E-MINI S&P 500',
};

function calcSentiment(ncLong, ncShort, prevNcLong, prevNcShort) {
  const netNow  = ncLong - ncShort;
  const netPrev = prevNcLong - prevNcShort;
  const change  = netNow - netPrev;
  if (netNow > 0 && change >= 0) return 'BULLISH';
  if (netNow > 0 && change < 0)  return 'BULLISH';
  if (netNow < 0 && change <= 0) return 'BEARISH';
  if (netNow < 0 && change > 0)  return 'BEARISH';
  return 'NEUTRAL';
}

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

    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json` +
      `?$where=market_and_exchange_names LIKE '%25${encodeURIComponent(searchTerm)}%25'` +
      `&$order=report_date_as_yyyy_mm_dd DESC` +
      `&$limit=3`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Atmos Intelligence contact@atmos.finance' }
    });

    if (!response.ok) return res.status(502).json({ error: `CFTC API returned ${response.status}` });

    const rows = await response.json();
    if (!rows || rows.length === 0) return res.status(404).json({ error: `No COT data found for: ${searchTerm}` });

    const filtered = rows.filter(r => !r.market_and_exchange_names.toLowerCase().includes('micro'));
    const curr = filtered[0] || rows[0];
    const prev = filtered[1] || rows[1] || curr;

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
    const sentiment   = calcSentiment(ncLong, ncShort, prevNcLong, prevNcShort);
    const strength    = calcStrength(ncLong, ncShort);

    res.json({
      asset: assetParam,
      market: curr.market_and_exchange_names,
      reportDate: curr.report_date_as_yyyy_mm_dd,
      prevDate: prev.report_date_as_yyyy_mm_dd,
      openInterest: openInt,
      nonCommercial: {
        long: ncLong, short: ncShort, net: ncNet,
        netChange: ncNetChange,
        spreading: parse(curr.noncomm_postions_spread_all),
      },
      commercial: { long: commLong, short: commShort, net: commNet },
      signal: {
        sentiment, strength,
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
// CENTRAL BANK RATES ENDPOINT
// FED: live from FRED API (DFEDTARU = upper target rate)
// Others: accurate hardcoded, updated June 2026
// ============================================
app.get('/api/rates', async (req, res) => {
  try {
    const FRED_KEY = process.env.FRED_API_KEY;

    let fedRate = 4.50;
    if (FRED_KEY) {
      try {
        const fredRes = await fetch(
          `https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&sort_order=desc&limit=1&api_key=${FRED_KEY}&file_type=json`
        );
        const fredData = await fredRes.json();
        const obs = fredData.observations?.[0];
        if (obs && obs.value !== '.') fedRate = parseFloat(obs.value);
      } catch (e) { /* fallback to hardcoded */ }
    }

    res.json({
      FED:  { rate: fedRate, bias: 'NEUTRAL', nextMeeting: 'Jun 18, 2026', lastDecision: 'HOLD',        live: true,  source: 'FRED API' },
      ECB:  { rate: 2.40,   bias: 'NEUTRAL', nextMeeting: 'Jul 24, 2026', lastDecision: 'HOLD',        live: false, source: 'Hardcoded Jun 2026' },
      BOJ:  { rate: 0.50,   bias: 'HAWKISH', nextMeeting: 'Jul 31, 2026', lastDecision: 'HOLD',        live: false, source: 'Hardcoded Jun 2026' },
      PBOC: { rate: 3.10,   bias: 'DOVISH',  nextMeeting: 'Aug 20, 2026', lastDecision: 'HOLD',        live: false, source: 'Hardcoded Jun 2026' },
      BOE:  { rate: 4.25,   bias: 'DOVISH',  nextMeeting: 'Jun 19, 2026', lastDecision: 'CUT -25bp',   live: false, source: 'Hardcoded Jun 2026' },
      RBA:  { rate: 4.10,   bias: 'DOVISH',  nextMeeting: 'Jul 8, 2026',  lastDecision: 'HOLD',        live: false, source: 'Hardcoded Jun 2026' },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// NEWS ENDPOINT
// ============================================
app.get('/api/news', async (req, res) => {
  try {
    const query  = req.query.q || 'geopolitical conflict war sanctions';
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GNEWS_API_KEY not configured' });
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=10&sortby=publishedAt&token=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.errors) return res.status(400).json({ error: data.errors[0] });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// POLITICIAN TRADES ENDPOINT
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
  console.log(`ATMOS BACKEND v2.2.0 running on port ${PORT}`);
});
