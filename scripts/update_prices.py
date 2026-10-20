#!/usr/bin/env python3
"""Fetch a small personal market watchlist and generate a GitHub Pages JSON snapshot.

Sources:
- Yahoo Finance via yfinance (educational/personal-use library; terms apply).
- MUFG AM and SBI AM fund-history CSV download links, with a limited fallback
  to their public quote/history pages (source terms apply).

No client-side API keys or proxy. When a fetch fails, preserve the last valid
quote and mark it cached; never synthesize a live price.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import math
import re
import sys
import time
from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parents[1]
OUTPUT = HERE / "public" / "data" / "market.json"
JST = ZoneInfo("Asia/Tokyo")
TODAY = datetime.now(JST).date()
START = TODAY - timedelta(days=400)
TROY_OUNCE_IN_GRAMS = 31.1034768
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PersonalPriceWatch/1.0; educational project)",
    "Accept": "text/html,application/octet-stream,text/csv,*/*",
}

STOCKS = [
    dict(id="komatsu", name="コマツ", short="コマツ", symbol="6301.T", group="jp", currency="JPY"),
    dict(id="shinetsu", name="信越化学工業", short="信越化学", symbol="4063.T", group="jp", currency="JPY"),
    dict(id="ajinomoto", name="味の素", short="味の素", symbol="2802.T", group="jp", currency="JPY"),
    dict(id="berkshire", name="Berkshire Hathaway B", short="バークシャー", symbol="BRK-B", group="us", currency="USD"),
    dict(id="tsmc", name="TSMC（NYSE ADR）", short="TSMC", symbol="TSM", group="us", currency="USD"),
    dict(id="alphabet", name="Alphabet / Google A", short="Google", symbol="GOOGL", group="us", currency="USD"),
    dict(id="autodesk", name="Autodesk", short="Autodesk", symbol="ADSK", group="us", currency="USD"),
    dict(id="genomics", name="10x Genomics", short="10x Genomics", symbol="TXG", group="us", currency="USD"),
    dict(id="sp500", name="S&P 500 Index", short="S&P 500", symbol="^GSPC", group="index", currency="PTS"),
]
FUNDS = [
    dict(
        id="allcountry", name="eMAXIS Slim 全世界株式（オール・カントリー）", short="オルカン",
        symbol="0331418A", group="fund", currency="JPY_10000",
        csv_url="https://www.am.mufg.jp/fund_file/setteirai/253425.csv",
        detail_url="https://www.am.mufg.jp/fund/253425.html",
        history_url="https://finance.yahoo.co.jp/quote/0331418A/history",
    ),
    dict(
        id="emaxis_sp500", name="eMAXIS Slim 米国株式（S&P500）", short="eMAXIS Slim S&P500",
        symbol="03311187", group="fund", currency="JPY_10000",
        csv_url="https://www.am.mufg.jp/fund_file/setteirai/253266.csv",
        detail_url="https://emaxis.am.mufg.jp/fund/253266.html",
        history_url="https://finance.yahoo.co.jp/quote/03311187/history",
    ),
    dict(
        id="sbi_div", name="SBI 全世界高配当株式ファンド（年4回決算型）", short="SBI 全世界高配当",
        symbol="8931124A", group="fund", currency="JPY_10000",
        csv_url="https://apl.wealthadvisor.jp/webasp/sbi_am/pc/download.aspx?fnc=2024100101&type=1",
        detail_url="https://apl.wealthadvisor.jp/webasp/sbi_am/pc/basic/sa_2024100101.html",
        history_url="https://finance.yahoo.co.jp/quote/8931124A/history",
    ),
]
GOLD = dict(id="gold", name="Gold / 金先物換算", short="Gold（1g）", symbol="GC=F × JPY=X", group="metal", currency="JPY_GRAM")


def is_number(v):
    try:
        return v is not None and math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def normalize_prices(points):
    """Return a bounded, strictly dated, ascending series of {date,value}."""
    by_date = {}
    for x in points or []:
        try:
            when = date.fromisoformat(str(x["date"])[:10])
            price = float(x["value"])
            if START <= when <= TODAY + timedelta(days=1) and math.isfinite(price) and price > 0:
                by_date[when.isoformat()] = round(price, 5)
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    return [{"date": d, "value": by_date[d]} for d in sorted(by_date)][-285:]


def market_asset(meta, new_prices, old=None, source=None, error=None):
    old = old or {}
    latest = normalize_prices((old.get("history") or []) + (new_prices or []))
    current = latest[-1] if latest else None
    prev = latest[-2] if len(latest) > 1 else None
    price = current["value"] if current else None
    before = prev["value"] if prev else None
    difference = round(price - before, 5) if price is not None and before is not None else None
    percent = round(difference / before * 100, 3) if difference is not None and before else None
    is_fresh = len(new_prices or []) > 0
    return {
        "id": meta["id"], "name": meta["name"], "short": meta["short"],
        "symbol": meta["symbol"], "group": meta["group"], "currency": meta["currency"],
        "source_url": source or old.get("source_url") or "",
        "price": price, "change": difference, "change_pct": percent,
        "as_of": current["date"] if current else None,
        "status": "ok" if is_fresh else ("cached" if price is not None else "unavailable"),
        "history": latest,
    }


def get_yahoo_tickers():
    """Fetch all Yahoo tickers at once; if that fails, retry tickers individually."""
    try:
        import pandas as pd
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError("Install dependencies from requirements.txt") from exc

    symbols = [i["symbol"] for i in STOCKS] + ["GC=F", "JPY=X"]
    series = {}
    logging.info("Yahoo Finance: fetching %d daily tickers", len(symbols))
    try:
        # Keeping threads off avoids unnecessary concurrent burst requests.
        raw = yf.download(
            tickers=symbols, period="1y", interval="1d", group_by="ticker",
            auto_adjust=False, actions=False, progress=False, threads=False,
            timeout=25,
        )
        for symbol in symbols:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if symbol in raw.columns.get_level_values(0):
                        closes = raw[symbol]["Close"]
                    else:
                        closes = raw.xs("Close", axis=1, level=0)[symbol]
                else:
                    closes = raw["Close"] if len(symbols) == 1 else pd.Series(dtype=float)
                parsed = [{"date": str(d.date()), "value": float(v)} for d, v in closes.dropna().items() if is_number(v)]
                series[symbol] = normalize_prices(parsed)
                if not series[symbol]:
                    logging.warning("No prices for %s in multi download", symbol)
            except Exception as exc:
                logging.warning("Cannot parse %s from multi download: %s", symbol, exc)
    except Exception as exc:
        logging.warning("Multi download failed: %s", exc)

    # Do not hammer Yahoo if multi-download succeeded for most symbols.
    missing = [s for s in symbols if not series.get(s)]
    for symbol in missing:
        try:
            time.sleep(0.6)
            frame = yf.Ticker(symbol).history(period="1y", interval="1d", auto_adjust=False, actions=False)
            parsed = [{"date": str(d.date()), "value": float(v)} for d, v in frame["Close"].dropna().items() if is_number(v)]
            series[symbol] = normalize_prices(parsed)
            if series[symbol]:
                logging.info("Recovered ticker %s with individual request", symbol)
        except Exception as exc:
            logging.warning("Ticker %s unavailable: %s", symbol, exc)
    return series


def parse_date_cell(s):
    s = str(s).strip().replace("\ufeff", "").replace("　", "")
    if not s:
        return None
    m = re.fullmatch(r"(20\d{2})[/-](\d{1,2})[/-](\d{1,2})", s)
    if m:
        try:
            return date(*(int(v) for v in m.groups())).isoformat()
        except ValueError:
            return None
    m = re.fullmatch(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", s)
    if m:
        try:
            return date(*(int(v) for v in m.groups())).isoformat()
        except ValueError:
            return None
    if re.fullmatch(r"20\d{6}", s):
        try:
            return datetime.strptime(s, "%Y%m%d").date().isoformat()
        except ValueError:
            return None
    return None


def parse_nav_cell(s):
    s = str(s).strip().replace("\ufeff", "").replace("，", ",").replace("円", "").replace(" ", "")
    if not re.fullmatch(r"\+?[\d,]+(?:\.\d+)?", s):
        return None
    try:
        n = float(s.replace(",", ""))
    except ValueError:
        return None
    # Expected Japanese mutual fund NAV per 10,000 units; reject accidental date/asset values.
    return n if 500 <= n < 2_000_000 and math.isfinite(n) else None


def nav_after_date(cells):
    """Read the first NAV value, even when a broken CSV split 37,500 in two."""
    for i, cell in enumerate(cells):
        first = str(cell).strip()
        # A few published CSVs omit quotes around thousands separators.
        if re.fullmatch(r"\d{1,3}", first):
            sections = [first]
            for next_cell in cells[i + 1:]:
                if re.fullmatch(r"\d{3}", str(next_cell).strip()):
                    sections.append(str(next_cell).strip())
                else:
                    break
            if len(sections) > 1:
                combined = parse_nav_cell("".join(sections))
                if combined is not None:
                    return combined
        val = parse_nav_cell(cell)
        if val is not None:
            return val
    return None


def parse_nav_csv(body):
    """Recognize date,NAV,... in common Shift-JIS/UTF-8 Japanese fund CSVs."""
    if isinstance(body, str):
        texts = [body]
    else:
        texts = []
        for enc in ("utf-8-sig", "cp932", "shift_jis", "euc_jp"):
            try:
                texts.append(body.decode(enc))
            except UnicodeDecodeError:
                pass
    best = []
    for content in texts:
        prices = []
        for row in csv.reader(io.StringIO(content.replace("\r", ""))):
            if not row:
                continue
            idx = next((i for i, cell in enumerate(row) if parse_date_cell(cell)), None)
            if idx is None:
                continue
            when = parse_date_cell(row[idx])
            nav = nav_after_date(row[idx + 1:])
            if when and nav is not None:
                prices.append({"date": when, "value": nav})
        normalized = normalize_prices(prices)
        if len(normalized) > len(best):
            best = normalized
    return best


def download_fund_csv(fund):
    response = requests.get(fund["csv_url"], headers=HEADERS, timeout=22)
    response.raise_for_status()
    if len(response.content) > 8_000_000:
        raise ValueError("Fund CSV unexpectedly large")
    data = parse_nav_csv(response.content)
    if not data:
        raise ValueError("CSV returned no usable date/NAV rows")
    return data


def parse_nav_history_html(body):
    soup = BeautifulSoup(body, "html.parser")
    rows = []
    for tr in soup.select("tr"):
        cols = [cell.get_text(" ", strip=True) for cell in tr.select("th,td")]
        if not cols:
            continue
        when = parse_date_cell(cols[0])
        nav = parse_nav_cell(cols[1]) if len(cols) >= 2 else None
        if when and nav is not None:
            rows.append({"date": when, "value": nav})
    return normalize_prices(rows)


def download_fund_html(fund):
    response = requests.get(fund["history_url"], headers=HEADERS, timeout=20)
    response.raise_for_status()
    data = parse_nav_history_html(response.content)
    if not data:
        raise ValueError("Public fund history page contains no readable NAV rows")
    return data


def get_fund(fund):
    try:
        points = download_fund_csv(fund)
        logging.info("%s: official CSV, %d points", fund["symbol"], len(points))
        return points, fund["detail_url"]
    except Exception as exc:
        logging.warning("%s: CSV download failed: %s", fund["symbol"], exc)
    try:
        points = download_fund_html(fund)
        logging.info("%s: public history page, %d points", fund["symbol"], len(points))
        return points, fund["history_url"]
    except Exception as exc:
        logging.warning("%s: history fallback failed: %s", fund["symbol"], exc)
        return [], fund["detail_url"]


def gold_in_yen_per_gram(gold, fx):
    """COMEX gold futures USD/troy oz * contemporaneous USD/JPY / 31.1034768."""
    fx_map = {p["date"]: float(p["value"]) for p in fx}
    fx_dates = sorted(fx_map)
    if not fx_dates:
        return []
    data = []
    for p in gold:
        when = p["date"]
        index = bisect_right(fx_dates, when) - 1
        if index < 0:
            continue
        match = fx_dates[index]
        # A 4 day fallback covers weekends and small calendar mismatches, not stale FX.
        if (date.fromisoformat(when) - date.fromisoformat(match)).days > 4:
            continue
        grams = (float(p["value"]) * fx_map[match]) / TROY_OUNCE_IN_GRAMS
        data.append({"date": when, "value": round(grams, 2)})
    return normalize_prices(data)


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    previous = {}
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logging.warning("Old JSON not available; starting from scratch")
    old_assets = {item["id"]: item for item in previous.get("assets", []) if isinstance(item, dict) and "id" in item}

    try:
        quotes = get_yahoo_tickers()
    except Exception as exc:
        logging.error("Yahoo Finance request completely failed: %s", exc)
        quotes = {}

    records = []
    for item in STOCKS:
        symbol = item["symbol"]
        src = f"https://finance.yahoo.co.jp/quote/{symbol}" if item["group"] == "jp" else f"https://finance.yahoo.com/quote/{symbol.replace('^', '%5E')}"
        records.append(market_asset(item, quotes.get(symbol, []), old_assets.get(item["id"]), src))

    for fund in FUNDS:
        data, src = get_fund(fund)
        records.append(market_asset(fund, data, old_assets.get(fund["id"]), src))

    gold = gold_in_yen_per_gram(quotes.get("GC=F", []), quotes.get("JPY=X", []))
    records.append(market_asset(GOLD, gold, old_assets.get(GOLD["id"]), "https://finance.yahoo.com/quote/GC%3DF/"))

    current_fx = normalize_prices(quotes.get("JPY=X", []))
    prev_fx = previous.get("fx") or {}
    fx_history = normalize_prices((prev_fx.get("history") or []) + current_fx)
    fx_current = fx_history[-1] if fx_history else None
    fx_previous = fx_history[-2] if len(fx_history) > 1 else None
    fx_change = round(fx_current["value"] - fx_previous["value"], 5) if fx_current and fx_previous else None
    fx_change_pct = round(fx_change / fx_previous["value"] * 100, 3) if fx_change is not None and fx_previous and fx_previous["value"] else None
    fx = {
        "usd_jpy": fx_current["value"] if fx_current else prev_fx.get("usd_jpy"),
        "previous_usd_jpy": fx_previous["value"] if fx_previous else prev_fx.get("previous_usd_jpy"),
        "change": fx_change if fx_change is not None else prev_fx.get("change"),
        "change_pct": fx_change_pct if fx_change_pct is not None else prev_fx.get("change_pct"),
        "as_of": fx_current["date"] if fx_current else prev_fx.get("as_of"),
        "previous_as_of": fx_previous["date"] if fx_previous else prev_fx.get("previous_as_of"),
        "status": "ok" if current_fx else ("cached" if prev_fx.get("usd_jpy") else "unavailable"),
        "history": fx_history if fx_history else prev_fx.get("history", []),
    }
    success = sum(item["status"] == "ok" for item in records)
    snapshot = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "timezone": "Asia/Tokyo", "fx": fx,
        "assets": records,
        "note": "Delayed/daily quotes. Gold is an estimated futures-based JPY/g price, not a retail purchase price. Fund NAV is per 10,000 units (ex distributions).",
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    logging.info("Saved %s | newly fetched %d/%d | cached %d | unavailable %d", OUTPUT, success, len(records), sum(x["status"] == "cached" for x in records), sum(x["status"] == "unavailable" for x in records))
    if not success:
        logging.warning("All data sources failed on this run. Deployed page will show cached prices or 'unavailable'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
