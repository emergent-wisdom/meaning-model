# 08 Fact check: dated facts in the market example

Checked on **2026-09-23** against public sources, by a fact-checking agent. The input was
`notes/facts-to-check.md`, read in full. The model was built from recollection only; this pass
checks those recollections.

**Scope**

- **Values at the cutoff:** all 9 numeric values. The four `judgment.*` and `regime.*` entries
  are authored opinions and were skipped.
- **Dated samples:** all 56 numeric samples. The three `h.pol.*` samples of
  `regime.us_crypto_policy` are authored categories and were skipped.
- **Dated events:** all 32 events: whether each happened, its date, and every figure in its text.

**Time conversion:** calendar time = 2026-01-01 + t x 30.44 days. Event intervals were converted
the same way. The tolerance for an event date was "within a few days". Because a 30.44-day month
drifts, several intervals sit 0.5 to 2 days away from the true date, and none by more than 3 days.

**Result:** cutoff values 9 ok. Dated samples 55 ok and 1 outside interval. Events 32 ok. No item
was "wrong" or "unverifiable".

## Method and sources

Raw data was downloaded wherever an open API existed, so most numbers below are read directly
from the data rather than from summaries.

| process | source used | note |
|---|---|---|
| Fed total assets, reserves | Federal Reserve H.4.1 data package, https://www.federalreserve.gov/datadownload/Output.aspx?rel=H41&filetype=zip. Total assets come from series `RESPPA_N.WW`, the Wednesday level that FRED republishes as WALCL. Reserve balances come from `RESH4R_N.WW`. | |
| Fed funds target | Fed target-range history, https://www.federalreserve.gov/monetarypolicy/openmarket.htm, plus the FOMC statements | The history page lists effective dates, one day after each decision |
| 10-year real yield | U.S. Treasury daily par real yield curve, 10-year | This is the source of H.15 and FRED DFII10 |
| TGA | Daily Treasury Statement, "TGA Closing Balance", via https://api.fiscaldata.treasury.gov | |
| ON RRP, standing repo, bill purchases | New York Fed Markets API, https://markets.newyorkfed.org/api/rp/results/search.json and /api/tsy/all/results/summary/search.json | |
| BTC/USD | Coin Metrics community API `PriceUSD`, the reference-rate close at 00:00 UTC that ends each day. Coinbase Exchange daily UTC candles were used as a cross-check. | The two agree within 0.5% on every date checked |
| DXY | Yahoo Finance history for DX-Y.NYB (the ICE US Dollar Index) | Read through a page-fetch tool. The 2025 close was cross-checked against CNBC and NPR year-end reporting (98.28). |
| Stablecoins | DefiLlama stablecoins API: the total for USD-pegged coins, and per-asset charts for the fiat-backed sum, classified by DefiLlama's `pegMechanism` | For 2020, also Coin Metrics `SplyCur` and a CoinMarketCap snapshot |
| US spot BTC ETF flows | Farside Investors all-data table, https://farside.co.uk/bitcoin-etf-flow-all-data/. Daily totals were summed from 2024-01-11. | As published on 2026-09-23 |
| Bitcoin blocks | mempool.space API | |
| Laws, orders, events | whitehouse.gov, federalreserve.gov, FDIC, Bank of Japan, CRS, CRFB, BIS, and news reporting (CoinDesk, CNBC, NPR, Reuters via US News, Fortune, Washington Post, Bankless, CoinGlass) | |

**Limits:**

- FRED timed out from this environment, so each series was taken from the publication FRED
  copies it from.
- MarketWatch, WSJ and Stooq serve bot checks. These were not bypassed.
- Yahoo's JSON API was rate-limited, so its public history pages were read instead.
- Nothing was signed into, accepted or submitted.

## 1. Values at the cutoff (t = 0, end of December 2025)

| item | recorded | found | source | verdict | note |
|---|---|---|---|---|---|
| btc.price_usd | 88,000 [80,000-100,000] | 87,517 (close 2025-12-31) | https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD&frequency=1d&start_time=2025-12-31&end_time=2025-12-31 | ok | Coinbase close was 87,498 |
| etps.us_spot_btc_cum_net_flow_usd_bn | 57 [50-65] | 56.59 | https://farside.co.uk/bitcoin-etf-flow-all-data/ | ok | Sum of daily totals from 2024-01-11 to 2025-12-31. The peak was 62.74 on 2025-10-09. Net flow was -3.47 in November and -1.09 in December. |
| fed.total_assets_usd_tn | 6.55 [6.4-6.8] | 6.641 (Wednesday 2025-12-31) | https://www.federalreserve.gov/datadownload/Output.aspx?rel=H41&filetype=zip (RESPPA_N.WW) | ok | The nearest weekly level includes a year-end bulge: standing repo was 74.6bn on Dec 31. Neighbouring weeks were 6.581 (Dec 24) and 6.574 (2026-01-07). |
| stablecoins.usd_supply_usd_bn (fiat-backed) | 270 [250-290] | 277.3 excluding tokenized funds; 281.4 including them | https://stablecoins.llama.fi/stablecoins (pegMechanism), summed over the per-asset /stablecoincharts/all?stablecoin={id} at 2025-12-31 | ok | USDT 187.06 plus USDC 75.99 is 263.1. The next largest were PYUSD 3.53, USD1 3.36 and RLUSD 1.34. The tokenized funds are BUIDL, USYC, USDY and YLDS, about 4.0 in total. The sum depends on how coins are classified. |
| us.fed_funds_upper_pct | 3.75 [3.75-4] | 3.75 | https://www.federalreserve.gov/newsevents/pressreleases/monetary20251210a.htm | ok | 3.50-3.75% decided 2025-12-10, effective 12-11 |
| us.real_yield_10y_pct | 1.85 [1.5-2.2] | 1.93 (2025-12-31) | https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2025/all?type=daily_treasury_real_yield_curve&field_tdr_date_value=2025&page&_format=csv | ok | |
| us.tga_usd_bn | 850 [700-1000] | 872.9 | https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?filter=record_date:eq:2025-12-31 | ok | DTS closing balance |
| usd.dxy_index | 98.5 [96-101] | 98.28 (close 2025-12-31) | https://finance.yahoo.com/quote/DX-Y.NYB/history/?period1=1766102400&period2=1767657600 | ok | Down 9.4% from the 2024 close of 108.49. CNBC and NPR report the same close. |
| stablecoins.usd_pegged_supply_usd_bn | 305 [285-325] | 306.66 (2025-12-31) | https://stablecoins.llama.fi/stablecoincharts/all | ok | USDT and USDC make up 85.8% of the total, which fits the "85-90%" in the meaning text |

## 2. Dated samples

Each date in the item column is the converted `value_time`. For weekly or holiday dates, the
nearest observations on both sides are given.

| item | recorded | found | source | verdict | note |
|---|---|---|---|---|---|
| h.btc.m12 (2024-12-31) | 93,500 [92,000-95,000] | 93,390 | https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD&frequency=1d&start_time=2024-12-31&end_time=2024-12-31 | ok | Coinbase 93,354 |
| h.btc.m16_87 (2024-08-05) | 54,000 [49,000-56,000] | 54,344 | ...&start_time=2024-08-05&end_time=2024-08-05 (same API) | ok | Coinbase close 54,029, intraday low 49,050 |
| h.btc.m1_33 (2025-11-21) | 84,000 [80,500-87,000] | 84,948 | ...&start_time=2025-11-21&end_time=2025-11-22 (same API) | ok | The lowest close was 84,775 on Nov 22. Coinbase intraday low was 80,525 on Nov 21. |
| h.btc.m21_58 (2024-03-15 01:47 UTC, labelled 03-14) | 71,500 [70,000-73,800] | 71,505 (close 03-14) | ...&start_time=2024-03-13&end_time=2024-03-15 (same API) | ok | The Mar 15 close (69,425) is just below the interval, but the Mar 14 close was in force at the sample time. The record close was 73,082 on Mar 13. Coinbase intraday high was 73,836 on Mar 14. |
| h.btc.m23_68 (2024-01-11) | 46,500 [45,000-48,500] | 46,381 | ...&start_time=2024-01-10&end_time=2024-01-11 (same API) | ok | Jan 10 close was 46,818 |
| h.btc.m2_84 (2025-10-06) | 124,500 [123,000-126,500] | 124,824 | ...&start_time=2025-10-06&end_time=2025-10-06 (same API) | ok | Coinbase 124,720 |
| h.btc.m37_33 (2022-11-21) | 15,800 [15,500-16,500] | 15,778 | ...&start_time=2022-11-21&end_time=2022-11-21 (same API) | ok | This low close is essentially tied with Nov 9 (15,758). Coinbase intraday low was 15,460 on Nov 21. |
| **h.btc.m49_7 (2021-11-10 03:10 UTC)** | 67,500 [66,000-69,000] | **64,756 (close 2021-11-10)** | https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD&frequency=1d&start_time=2021-11-08&end_time=2021-11-10 | **outside interval** | This is marginal and depends on the definition. Coinbase closed at 64,912. The recorded 67,500 matches the record close of Nov 8 (67,542). It also sits near the Nov 9 close (67,096), the latest close at 03:10 UTC. See Findings. |
| h.btc.m8_8 (2025-04-08 03:04 UTC, labelled 04-07) | 78,000 [74,500-80,000] | 79,422 (close 04-07) | ...&start_time=2025-04-06&end_time=2025-04-08 (same API) | ok | Apr 8 close was 76,351, also inside the interval |
| h.dxy.m12 (2024-12-31) | 108.5 [107-110] | 108.49 | https://finance.yahoo.com/quote/DX-Y.NYB/history/?period1=1734998400&period2=1736121600 | ok | |
| h.dxy.m24 (2024-01-01, holiday) | 101.5 [100-103] | 101.33 (2023-12-29); 102.20 (2024-01-02) | https://finance.yahoo.com/quote/DX-Y.NYB/history/?period1=1703203200&period2=1704499200 | ok | |
| h.dxy.m39 (2022-10-01, Saturday) | 112 [110-115] | 112.12 (2022-09-30); 111.75 (10-03) | https://finance.yahoo.com/quote/DX-Y.NYB/history/?period1=1664150400&period2=1665014400 | ok | The cycle's intraday high was 114.78 on 2022-09-28 |
| h.dxy.m6 (2025-07-02) | 97 [96-98.5] | 96.78 | https://finance.yahoo.com/quote/DX-Y.NYB/history/?period1=1750809600&period2=1751760000 | ok | Jul 1 close was 96.82 |
| h.etf.m12 (2024-12-31) | 35.5 [33-38] | 35.25 | https://farside.co.uk/bitcoin-etf-flow-all-data/ | ok | Cumulative through 2024-12-31 |
| h.etf.m2 (2025-11-01) | 61 [56-65] | 61.15 | https://farside.co.uk/bitcoin-etf-flow-all-data/ | ok | Cumulative through Oct 31 |
| h.etf.m3 (2025-10-01) | 58 [55-62] | 57.73 (through Sep 30); 58.40 (through Oct 1) | https://farside.co.uk/bitcoin-etf-flow-all-data/ | ok | |
| h.fed.m12 (2024-12-31) | 6.85 [6.75-7] | 6.852 (Wednesday 2025-01-01) | https://www.federalreserve.gov/datadownload/Output.aspx?rel=H41&filetype=zip (RESPPA_N.WW) | ok | |
| h.fed.m134 (2014-11-01) | 4.5 [4.4-4.55] | 4.487 (Oct 29 and Nov 5) | same H.4.1 package | ok | |
| h.fed.m2 (2025-11-01) | 6.6 [6.5-6.7] | 6.587 (Oct 29); 6.573 (Nov 5) | same H.4.1 package | ok | |
| h.fed.m208 (2008-08-31) | 0.9 [0.85-0.95] | 0.911 (Aug 27); 0.906 (Sep 3) | same H.4.1 package | ok | |
| h.fed.m24 (2024-01-01) | 7.7 [7.6-7.8] | 7.713 (2023-12-27); 7.681 (2024-01-03) | same H.4.1 package | ok | |
| h.fed.m45 (2022-04-02) | 8.95 [8.85-9] | 8.937 (Mar 30); 8.938 (Apr 6) | same H.4.1 package | ok | The peak was 8.965 on 2022-04-13 |
| h.fed.m6 (2025-07-02) | 6.7 [6.6-6.8] | 6.660 | same H.4.1 package | ok | |
| h.fed.m71 (2020-01-31) | 4.2 [4.1-4.3] | 4.152 (Jan 29); 4.167 (Feb 5) | same H.4.1 package | ok | |
| h.ffr.m12 (2025-01-01) | 4.5 exact | 4.50 | https://www.federalreserve.gov/monetarypolicy/openmarket.htm | ok | 4.25-4.50 effective 2024-12-19 |
| h.ffr.m120 (2016-01-01) | 0.5 exact | 0.50 | same page | ok | 0.25-0.50 effective 2015-12-17 |
| h.ffr.m15 (2024-10-01) | 5 exact | 5.00 | same page | ok | 4.75-5.00 effective 2024-09-19 |
| h.ffr.m2 (2025-11-01) | 4 exact | 4.00 | same page | ok | 3.75-4.00 effective 2025-10-30 |
| h.ffr.m204 (2009-01-01) | 0.25 exact | 0.25 | same page | ok | 0-0.25 from 2008-12-16 |
| h.ffr.m24 (2024-01-01) | 5.5 exact | 5.50 | same page | ok | 5.25-5.50 effective 2023-07-27 |
| h.ffr.m3 (2025-10-01) | 4.25 exact | 4.25 | same page | ok | 4.00-4.25 effective 2025-09-18 |
| h.ffr.m36 (2023-01-01) | 4.5 exact | 4.50 | same page | ok | 4.25-4.50 effective 2022-12-15 |
| h.ffr.m46 (2022-03-02) | 0.25 exact | 0.25 | same page | ok | The first hike took effect 2022-03-17 |
| h.ffr.m69 (2020-04-01) | 0.25 exact | 0.25 | same page | ok | 0-0.25 effective 2020-03-16 |
| h.ffr.m72 (2020-01-01) | 1.75 exact | 1.75 | same page | ok | 1.50-1.75 effective 2019-10-31 |
| h.ffr.m84 (2019-01-01) | 2.5 exact | 2.50 | same page | ok | 2.25-2.50 effective 2018-12-20 |
| h.ry.m12 (2024-12-31) | 2.2 [2.0-2.3] | 2.24 | https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2024/all?type=daily_treasury_real_yield_curve&field_tdr_date_value=2024&page&_format=csv | ok | |
| h.ry.m24 (2024-01-01) | 1.75 [1.6-1.9] | 1.72 (2023-12-29); 1.74 (2024-01-02) | same CSV, 2023 and 2024 | ok | |
| h.ry.m27 (2023-10-02) | 2.3 [2.1-2.5] | 2.34 | same CSV, 2023 | ok | Sep 29 was 2.24 |
| h.ry.m50 (2021-11-01) | -1.0 [-1.2 to -0.8] | -0.92 | same CSV, 2021 | ok | |
| h.ry.m6 (2025-07-02) | 2.0 [1.8-2.1] | 2.00 | same CSV, 2025 | ok | Jul 1 was 1.97 |
| h.sc.m12 (2024-12-31) | 203 [195-212] | 205.45 | https://stablecoins.llama.fi/stablecoincharts/all | ok | |
| h.sc.m24 (2024-01-01) | 135 [128-142] | 129.84 | same | ok | The point value is 5 high |
| h.sc.m27 (2023-10-02) | 123 [118-130] | 123.59 | same | ok | |
| h.sc.m3 (2025-10-01) | 295 [285-305] | 297.47 | same | ok | |
| h.sc.m45 (2022-04-02) | 185 [175-195] | 187.39 | same | ok | DefiLlama's total includes UST |
| h.sc.m6 (2025-07-02) | 250 [240-262] | 252.52 | same | ok | |
| h.sc.m72 (2020-01-01) | 5.5 [4.5-7] | about 5.2-5.9 | https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=usdt,usdc,pax,tusd,husd,dai,busd,gusd&metrics=SplyCur&frequency=1d&start_time=2020-01-01&end_time=2020-01-01 | ok | This depends on the aggregator. Coin Metrics gives USDT 4.77 of issued supply across Ethereum, Omni and Tron, plus 1.07 for the other coins. CoinMarketCap's 2019-12-29 snapshot gives USDT 4.13. DefiLlama's total is 4.17, outside the interval, because it carries USDT at only 3.20 and appears to omit Omni. |
| h.sc.t0.pegged (2025-12-31) | 305 [285-325] | 306.66 | https://stablecoins.llama.fi/stablecoincharts/all | ok | |
| h.scfiat.t0 (2025-12-31) | 270 [250-290] | 277.3 (281.4 including tokenized funds) | https://stablecoins.llama.fi/stablecoins (pegMechanism) plus per-asset charts | ok | See the cutoff table |
| h.tga.m12 (2024-12-31) | 720 [600-850] | 721.9 | https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?filter=record_date:eq:2024-12-31 | ok | |
| h.tga.m2 (2025-11-01) | 950 [800-1050] | 926.3 (Oct 31); 925.0 (Nov 3) | ...?filter=record_date:eq:2025-10-31 (same API) | ok | The peak was 1,000.6 on Oct 30 |
| h.tga.m24 (2024-01-01) | 750 [650-850] | 768.6 (2023-12-29); 766.3 (2024-01-02) | ...?filter=record_date:eq:2024-01-02 (same API) | ok | |
| h.tga.m27 (2023-10-02) | 670 [600-800] | 677.9 | ...?filter=record_date:eq:2023-10-02 (same API) | ok | |
| h.tga.m31 (2023-06-02) | 40 [20-100] | 23.4 | ...?filter=record_date:eq:2023-06-02 (same API) | ok | The point value is 17 high. The low was 22.9 on Jun 1. |
| h.tga.m6 (2025-07-02) | 350 [250-450] | 372.2 | ...?filter=record_date:eq:2025-07-02 (same API) | ok | Jul 1 was 367.5. Quarter-end Jun 30 was 457.0, and the low was 282.4 on Jul 11. |

The three `h.pol.*` samples (m18, m30, m5) were skipped because they are authored categories,
not measurements.

## 3. Dated events

The recorded column gives the converted interval in UTC.

| item | recorded | found | source | verdict | note |
|---|---|---|---|---|---|
| ev.bitcoin_whitepaper | 2008-10-30 09:15 to 10-31 08:38 | Posted to the Cryptography mailing list on Fri 2008-10-31 at 14:10 EDT | https://www.metzdowd.com/pipermail/cryptography/2008-October/014810.html | ok | The interval ends about 10 hours before the post |
| ev.genesis_block | 2009-01-02 05:14 to 01-03 04:37 | Block 0 timestamp is 2009-01-03 18:15:05 UTC | https://mempool.space/api/block/000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f | ok | The interval ends about 14 hours early |
| ev.fed_qe1_zlb_2008 | 2008-11-24 to 12-16 | 2008-11-25: purchases of up to $100bn of GSE debt and $500bn of MBS. 2008-12-16: target range 0-0.25%. | https://www.federalreserve.gov/newsevents/pressreleases/monetary20081125b.htm | ok | Cut confirmed by the release monetary20081216b |
| ev.fed_zlb_qe_2020 | 2020-03-04 to 03-24 | 03-03: cut of 50bp to 1.00-1.25. 03-15: cut to 0-0.25, with at least $500bn of Treasuries and $200bn of MBS. 03-23: purchases "in the amounts needed". | https://www.federalreserve.gov/newsevents/pressreleases/monetary20200315a.htm | ok | The interval starts about 13 hours after the Mar 3 cut |
| ev.btc_ath_2021 | 2021-11-10 to 11-11 | Intraday high of $69,000 on 2021-11-10 (Coinbase) | https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=2021-11-06T00:00:00Z&end=2021-11-14T00:00:00Z | ok | |
| ev.fed_first_hike_2022 | 2022-03-17 to 03-18 | Decided 2022-03-16 (0.25-0.50), effective 03-17 | https://www.federalreserve.gov/newsevents/pressreleases/monetary20220316a.htm | ok | |
| ev.terra_collapse | 2022-05-10 to 05-17 | UST first slipped on May 7 and broke its peg on May 9 (as low as $0.65). It was about $0.11 by May 16, and LUNA went to roughly zero. | https://www.coindesk.com/business/2022/05/09/ust-stablecoin-falls-below-dollar-peg-for-second-time-in-48-hours | ok | The interval starts 1-3 days after the first depeg |
| ev.qt_start_2022 | 2022-06-02 to 06-03 | Runoff began 2022-06-01, per the plan of May 4, 2022 | https://www.federalreserve.gov/newsevents/pressreleases/monetary20220504b.htm | ok | |
| ev.celsius_3ac_2022 | 2022-06-14 to 07-15 | Celsius paused withdrawals on June 12. A BVI court ordered 3AC into liquidation on June 27. Celsius filed for Chapter 11 on July 13. | https://fortune.com/2022/07/22/potential-legal-trouble-celsius-three-arrows-capital/ | ok | The interval starts 2 days after the pause. Filing date per the Washington Post, 2022-07-13. |
| ev.ftx_collapse | 2022-11-06 to 11-12 | Chapter 11 filing on 2022-11-11, after the run of Nov 6-10 | https://www.coindesk.com/policy/2022/11/11/ftx-files-for-bankruptcy-protections-in-us | ok | |
| ev.svb_usdc_depeg_2023 | 2023-03-11 to 03-15 | SVB closed Mar 10. USDC fell to about $0.88 on Mar 11, with $3.3bn of reserves at SVB. The backstop and BTFP were announced Mar 12. | https://www.federalreserve.gov/newsevents/pressreleases/monetary20230312a.htm | ok | The interval starts about 1.5 days after SVB closed (FDIC release pr23016) |
| ev.debt_limit_2023_tga_rebuild | 2023-06-04 to 10-02 | The Fiscal Responsibility Act was signed 2023-06-03, suspending the limit through 2025-01-01. From Jun 2 to Oct 2, the TGA rose from 23.4 to 677.9bn while ON RRP fell from 2,142 to 1,366bn. | https://www.congress.gov/crs-product/IN11829 | ok | ON RRP fell by more than the TGA rose, which fits "absorbed by ON RRP" (DTS and NY Fed data) |
| ev.final_hike_2023 | 2023-07-27 to 07-28 | Decided 2023-07-26 (5.25-5.50), effective 07-27 | https://www.federalreserve.gov/newsevents/pressreleases/monetary20230726a.htm | ok | |
| ev.spot_btc_etf_launch | 2024-01-10 to 01-12 | Approved 2024-01-10 (11 ETPs); trading began 01-11 | https://www.congress.gov/crs-product/IF12573 | ok | |
| ev.halving_2024 | 2024-04-20 00:34 to 04-22 | Block 840,000 at 2024-04-20 00:09:27 UTC; the subsidy fell from 6.25 to 3.125 BTC | https://mempool.space/api/block/0000000000000000000320283a032748cef8227873ff4872689bf23f1cda83a5 | ok | Subsidy confirmed from blocks 839,999 and 840,000 |
| ev.qt_taper_2024 | 2024-06-01 to 06-02 | "Beginning in June", the Treasury cap fell from $60bn to $25bn (announced 2024-05-01) | https://www.federalreserve.gov/newsevents/pressreleases/monetary20240501a.htm | ok | |
| ev.yen_carry_unwind_2024 | 2024-07-31 to 08-07 | The BoJ raised its call-rate target to around 0.25% on 2024-07-31. Nikkei and Topix fell more than 12% on Aug 5. | https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2024/k240731a.pdf | ok | See also BIS Bulletin 90 |
| ev.fed_cuts_2024 | 2024-09-18 to 12-18 | Cuts of 50bp on Sep 18, 25bp on Nov 7 and 25bp on Dec 18, taking the upper bound from 5.50 to 4.50 | https://www.federalreserve.gov/newsevents/pressreleases/monetary20241218a.htm | ok | Releases for Sep 18 and Nov 7 also checked |
| ev.us_election_2024 | 2024-11-04 21:19 to 11-05 22:09 | Election on 2024-11-05; Trump's win was called early on Nov 6 | https://www.npr.org/live-updates/trump-harris-2024-election-results | ok | |
| ev.debt_limit_2025_tga_drawdown | 2025-01-01 to 07-05 | The limit was reinstated 2025-01-02 at $36.1T, with extraordinary measures from Jan 21. The TGA went from 721.9bn (Dec 31) to a peak of 842.2 (Feb 11) and a low of 260.8 (Jun 12), then 313.2 on Jul 3. | https://www.axios.com/2025/01/18/debt-ceiling-limit-extraordinary-measures-2025 | ok | Reserve balances rose from 3.22T (2024-12-25) to 3.43T (2025-06-11), which supports "added reserves" (H.4.1) |
| ev.strategic_btc_reserve_eo | 2025-03-07 to 03-08 | Order signed 2025-03-06 | https://www.whitehouse.gov/presidential-actions/2025/03/establishment-of-the-strategic-bitcoin-reserve-and-united-states-digital-asset-stockpile/ | ok | The interval is about 1 day late |
| ev.qt_taper_2025 | 2025-04-02 to 04-03 | "Beginning in April", the Treasury cap fell from $25bn to $5bn (announced 2025-03-19) | https://www.federalreserve.gov/newsevents/pressreleases/monetary20250319a.htm | ok | |
| ev.tariff_shock_2025 | 2025-04-03 to 04-11 | Reciprocal-tariff order of 2025-04-02. DXY went from 103.81 (Apr 2) to 99.78 (Apr 11), and BTC closed at 76,351 on Apr 8. | https://www.whitehouse.gov/presidential-actions/2025/04/regulating-imports-with-a-reciprocal-tariff-to-rectify-trade-practices-that-contribute-to-large-and-persistent-annual-united-states-goods-trade-deficits/ | ok | "Dollar weakens" is confirmed (Yahoo DX-Y.NYB) |
| ev.genius_act | 2025-07-19 to 07-20 | Signed 2025-07-18 | https://www.whitehouse.gov/fact-sheets/2025/07/fact-sheet-president-donald-j-trump-signs-genius-act-into-law/ | ok | The interval starts less than 1 day after the signing |
| ev.obbba_tga_rebuild_2025 | 2025-07-05 to 11-01 | Signed 2025-07-04; it raised the limit by $5T to $41.1T. The TGA went from a low of 282.4bn (Jul 11) to 1,000.6 (Oct 30). ON RRP fell from 237bn (Jul 2) to 8-25bn in October. | https://www.crfb.org/papers/qa-everything-you-should-know-about-debt-ceiling | ok | Reserves fell from 3.26T (Jul 2) to 2.83T (Oct 29), which supports "drew down bank reserves" (DTS, NY Fed and H.4.1 data) |
| ev.fed_cuts_2025 | 2025-09-17 to 12-11 | Cuts of 25bp each on Sep 17, Oct 29 and Dec 10, taking the upper bound from 4.50 to 3.75 | https://www.federalreserve.gov/newsevents/pressreleases/monetary20251210a.htm | ok | Releases for Sep 17 and Oct 29 also checked |
| ev.gov_shutdown_2025 | 2025-10-01 to 11-13 07:06 | Shutdown from 2025-10-01 to late 11-12, lasting 43 days | https://www.npr.org/2025/11/13/nx-s1-5606921/longest-government-shutdown-in-u-s-history-ends-after-43-days | ok | |
| ev.btc_ath_oct_2025 | 2025-10-06 to 10-07 | Intraday high of $126,296 on 2025-10-06 (Coinbase) | https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=2025-10-03T00:00:00Z&end=2025-10-12T00:00:00Z | ok | |
| ev.liquidation_cascade_oct_2025 | 2025-10-10 to 10-12 | Liquidations exceeded $19bn on Oct 10-11, after Trump's threat of 100% tariffs on China | https://www.coinglass.com/learn/2025-annual-report-en | ok | CoinGlass adds that undisclosed liquidations probably put the true scale at $30-40bn |
| ev.repo_pressure_qt_end_2025 | 2025-10-29 to 12-01 | The standing repo facility lent $50.35bn on Oct 31, the most since it began in 2021. The Oct 29 statement concluded runoff on Dec 1. | https://money.usnews.com/investing/news/articles/2025-10-31/banks-tap-fed-standing-repo-facility-in-record-numbers-amid-month-end-pressures | ok | Confirmed by NY Fed operation data. A larger record, $74.6bn on Dec 31, falls after the interval. |
| ev.btc_drawdown_q4_2025 | 2025-10-06 to 2026-01-01 | Measured from the 126,296 intraday high, BTC fell 36.2% to the Nov 21 intraday low (80,525) and 30.7% to the Dec 31 close (87,498). ETF net flows were -3.47bn in November and -1.09bn in December. Strategy traded below mNAV 1 on 2025-11-13. | https://www.bankless.com/read/news/mstr-breaks-premium-streak-trading-below-nav-for-first-time-since-january-2024 | ok | "About 30-35%" depends on the measure. Price data from Coinbase and flow data from Farside. Rate cuts and the end of runoff are confirmed above. |
| ev.reserve_mgmt_purchases_2025 | 2025-12-12 to 2026-01-01 | The Dec 10 statement committed to "purchases of shorter-term Treasury securities". The first bill purchase was $8.2bn on Dec 12, and about $38bn was bought through Dec 22. | https://markets.newyorkfed.org/api/tsy/all/results/summary/search.json?startDate=2025-12-01&endDate=2025-12-31 | ok | "Moderate confidence" can be raised to confirmed |

## Findings

### Items that are not ok

1. **hist.sample.h.btc.m49_7: outside the interval.** The miss is small and depends on how the
   sample is defined.
   - **Recorded:** 67,500 [66,000-69,000], for the "BTC/USD daily close near 2021-11-10
     (all-time high then)".
   - **Found:** the 2021-11-10 close was 64,756 (Coin Metrics) or 64,912 (Coinbase). That is
     about 1,100 below the lower bound, after an intraday high of $69,000 that day.
   - **Why 67,500 was recorded:** it is the record daily close of 2021-11-08 (67,542). It is also
     close to the 2021-11-09 close (67,096), the last close in force at the sample's timestamp of
     03:10 UTC on Nov 10.
   - **Suggested fix:** either keep the date and record about 64,800 [63,500-66,500], or re-date
     the sample to 2021-11-08 (t ≈ -49.77) and label it as the cycle's record daily close.
   - **Source:**
     https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD&frequency=1d&start_time=2021-11-08&end_time=2021-11-10

### Ok, but worth stating in the published note

- **h.sc.m72 (2020-01-01) depends on the aggregator.** DefiLlama's USD-pegged total is 4.17bn,
  below the interval, because it counts USDT at 3.20bn. CoinMarketCap's snapshot gives 4.13bn,
  and DefiLlama appears to leave out USDT on the Omni layer. Coin Metrics and CoinMarketCap give
  about 5.2-5.9bn, which is inside the interval. If the published model names DefiLlama as its
  frame, the lower bound of 4.5 fails on that aggregator's own figure.
- **Some point values are notably off but still inside wide intervals:**
  - `h.tga.m31`: 40 recorded vs 23.4 found.
  - `h.sc.m24`: 135 recorded vs 129.8 found.
  - `fed.total_assets_usd_tn` at the cutoff: 6.55 recorded vs 6.641 found, for the nearest
    weekly level (a year-end bulge).
  - `h.tga.m2`: 950 recorded vs 926.3 found.
  - `stablecoins.usd_supply_usd_bn`: 270 recorded vs 277-281 found.
- **The Q4 2025 drawdown figure depends on the measure.** "About 30-35%" holds, but the fall
  from the intraday high was 36% to the intraday trough and 31% to the year-end close.
- **Event intervals drift with the 30.44-day month.** The whitepaper and genesis intervals end
  10-14 hours before the actual events. The Strategic Bitcoin Reserve order, GENIUS signing,
  Terra, Celsius and SVB intervals begin 0.5-3 days after the first actual date. All are within
  the few-days tolerance.
- **The reserve-management purchases event can be upgraded from "moderate confidence".** It is
  confirmed by the FOMC statement and by NY Fed operation results starting 2025-12-12.
- **The definitions used here should be stated alongside the model.**
  - BTC closes are Coin Metrics reference-rate closes at 00:00 UTC.
  - DXY is the Yahoo DX-Y.NYB close.
  - ETF flows are Farside daily totals as published on 2026-09-23. Farside revises late prints.
  - The fiat-backed stablecoin total uses DefiLlama's `pegMechanism` classification. It changes
    by about 4bn depending on whether tokenized funds are counted.
