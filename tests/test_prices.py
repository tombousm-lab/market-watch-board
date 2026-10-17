import unittest
from unittest.mock import patch

from scripts.update_prices import (
    START, TODAY, parse_date_cell, parse_nav_csv,
    parse_nav_history_html, market_asset, gold_in_yen_per_gram,
)


class MarketDataTests(unittest.TestCase):
    def test_nav_date_formats(self):
        self.assertEqual(parse_date_cell('2026/10/16'), '2026-10-16')
        self.assertEqual(parse_date_cell('2026年10月16日'), '2026-10-16')
        self.assertEqual(parse_date_cell('20261016'), '2026-10-16')
        self.assertIsNone(parse_date_cell('昨夜'))

    def test_shift_jis_csv(self):
        d = TODAY.isoformat().replace('-', '/')
        s = '年月日,基準価額,純資産\n' + f'{d},13,000,190\n'
        # Normal CSV with quoted comma, as produced by some investment sites.
        s = '年月日,基準価額,純資産\n' + f'{d},"13,000",190\n'
        parsed = parse_nav_csv(s.encode('cp932'))
        self.assertEqual(parsed[-1]['value'], 13000)

    def test_nav_csv_yyyymmdd(self):
        d = TODAY.isoformat().replace('-', '')
        s = f'日付,基準価額\n{d},34567\n'
        self.assertEqual(parse_nav_csv(s.encode('utf-8'))[-1]['value'], 34567)

    def test_nav_csv_official_date(self):
        d = TODAY.isoformat()
        s = f'基準日,基準価額,差\n{d},37,500\n'
        # Numeric tokens must be CSV-quoted if containing thousands separator.
        self.assertEqual(parse_nav_csv(s.encode('utf-8'))[-1]['value'], 37500)

    def test_html_fallback(self):
        day = TODAY.strftime('%Y/%m/%d')
        html = f'<table><tr><th>日付</th><th>基準価額</th></tr><tr><td>{day}</td><td>13,605</td></tr></table>'
        self.assertEqual(parse_nav_history_html(html)[-1]['value'], 13605)

    def test_gold_unit_conversion(self):
        day = TODAY.isoformat()
        converted = gold_in_yen_per_gram([{'date': day, 'value': 3100}], [{'date': day,'value':155}])
        self.assertAlmostEqual(converted[-1]['value'], 15448.43, places=0)

    def test_cache_marked(self):
        meta={'id':'test','name':'TEST','short':'T','symbol':'T','group':'us','currency':'USD'}
        two_dates=[{'date':(TODAY.replace(day=TODAY.day) if TODAY.day>1 else TODAY).isoformat(),'value':10}]
        rec=market_asset(meta,[],old={'history':two_dates})
        self.assertEqual(rec['status'],'cached')
        self.assertEqual(rec['price'],10)


if __name__ == '__main__':
    unittest.main()
