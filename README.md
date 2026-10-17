# Market Desk — 株価・投信・金の自動更新ダッシュボード

**GitHub Freeだけで公開できる、12銘柄の個人用価格ウォッチリスト**です。HTML/CSS/JavaScript の静的サイトを GitHub Pages で配信し、GitHub Actions が原則毎時23分に Python で価格を取得して JSON を更新・再デプロイします。

> **先に確認：** これは「リアルタイム株価配信サービス」ではありません。日足の終値・基準価額等の遅延データを定期的に再取得した、個人学習用プロジェクトです。GitHub PagesのURLは**誰でも閲覧可能**です。市場データ提供元の利用規約・再配信権利を確認のうえ公開してください。

## 登録済みの12銘柄

| 銘柄 | データ識別子 | 表示価格 |
|---|---|---|
| コマツ | `6301.T` | 円/株 |
| 信越化学工業 | `4063.T` | 円/株 |
| 味の素 | `2802.T` | 円/株 |
| Berkshire Hathaway **B株** | `BRK-B` | USD/株 |
| TSMC **NYSE上場ADR** | `TSM` | USD/ADR |
| Alphabet (Google) **A株** | `GOOGL` | USD/株 |
| Autodesk | `ADSK` | USD/株 |
| 10x Genomics | `TXG` | USD/株 |
| S&P 500 **指数** | `^GSPC` | pt（ETF価格ではない） |
| eMAXIS Slim 全世界株式（オール・カントリー） | `0331418A` | 基準価額・円/1万口 |
| SBI 全世界高配当株式ファンド（**年4回決算型**） | `8931124A` | 基準価額・円/1万口 |
| Gold | `GC=F` と `JPY=X` | 金先物を円/1gに換算した参考値 |

SBI全世界高配当には別に「**年1回決算型**（8931224A）」もあります。このプロジェクトは年4回決算型です。

金は **金先物 USD/トロイオンス × USD/JPY ÷ 31.1034768** で計算します。小売価格、買取価格、税込店頭価格、金現物スポット価格とは一致しません。

## 使える機能

- 12銘柄の最新取得価格、直前取引日比・騰落率、基準日を表示
- 過去1か月のミニチャートと、クリックして開く1M/3M/6M/1Yチャート
- 日本株／米国株／指数／投資信託／金の絞り込み、検索、騰落率ソート
- お気に入りのローカル保存（自分のブラウザのみ。ログインや同期なし）
- 米国株の**参考円換算**表示（当日の株価の騰落率はUSD建てのまま）
- データ取得に失敗した場合、前回の価格を保持して「取得失敗・保存値」と表示
- **日本時間の毎時23分に更新処理を開始する予定（1日24回）**（GitHubのスケジューラ次第で遅延・実行省略あり）

## GitHubで無料公開する（新しいリポジトリを作る場合）

### 1. リポジトリを作る

1. GitHubにログイン → 「New repository」から `market-watch-board` という名前で作成します。
2. **Public** を選択してください（GitHub FreeでPagesを使うため）。
3. 既存ファイルを重複させないよう、`Add a README file` はオフで作成すると簡単です。

### 2. この一式をGitHubにアップロードする

ZIPを展開して、`market-watch-board` フォルダ内にあるファイル**一式**を、新しく作ったリポジトリの**ルート**に配置します。`.github/workflows/update.yml` も必要です。

Macのターミナルで `git` を使う場合、ZIP展開後にフォルダ内で以下を実行します（`YOUR_NAME` は自分のGitHubユーザー名に置き換え）：

```bash
cd ~/Downloads/market-watch-board
git init -b main
git add .
git commit -m "Create market dashboard"
git remote add origin https://github.com/YOUR_NAME/market-watch-board.git
git push -u origin main
```

GitHubのWeb画面からアップロードする場合は、解凍した中身を「Add file → Upload files」でアップロードします。ファイルを1つずつでなく、フォルダ構成ごと含めてください。MacのFinderで `.github` が見えない場合は `⌘ + Shift + .` で隠しファイルを表示できます。

### 3. Pagesの公開元を設定

リポジトリの **Settings → Pages → Build and deployment → Source → GitHub Actions** を選択します。「Deploy from a branch」ではなく**GitHub Actions**です。`public/` フォルダだけを配信するワークフローを同梱しています。

### 4. 自動更新を初回実行

1. リポジトリの **Actions** を開きます。
2. **Update prices and publish dashboard** を選択します。
3. **Run workflow → Run workflow** を押します。
4. 緑のチェックが付けば公開成功。**Settings → Pages** にURLが出ます。

URLはおおむね `https://YOUR_NAME.github.io/market-watch-board/` の形式です。

株価が空欄の場合は Actions → 最新のワークフロー → `Refresh prices and fund NAV` のログを確認してください。取得元にアクセスできないときは、数値を捏造せず「未取得」にします。

### 5. 必要に応じて GitHub Actions の権限を確認

データをリポジトリに保存する `git push` が拒否される場合、**Settings → Actions → General → Workflow permissions → Read and write permissions** を有効化できるか確認してください。公開デプロイはPushに失敗しても続行される設計ですが、キャッシュデータを次回まで維持するには書き込み権限が必要です。

## ディレクトリ構成

```text
market-watch-board/
├── .github/workflows/update.yml    # 毎時23分の定期取得・公開
├── scripts/update_prices.py         # 株式・投資信託・金価格をJSON化
├── requirements.txt                 # Pythonライブラリ
├── public/
│   ├── index.html                   # 画面
│   ├── style.css                    # レスポンシブデザイン
│   ├── app.js                       # チャート、絞り込み、検索など
│   ├── favicon.svg
│   └── data/market.json             # GitHub Actionsが生成。最初は空
├── tests/test_prices.py
└── README.md
```

## データはどこから来る？

| データ | 取得方法 | リンク |
|---|---|---|
| 日本株・米国株・S&P500・金先物・為替 | `yfinance` によるYahoo Finance系の日次データ | https://github.com/ranaroussi/yfinance |
| オルカン | 三菱UFJアセットマネジメントの設定来CSV | https://www.am.mufg.jp/fund_file/setteirai/253425.csv |
| SBI全世界高配当 | SBIアセットマネジメント/ウエルスアドバイザーのCSV | https://apl.wealthadvisor.jp/webasp/sbi_am/pc/download.aspx?fnc=2024100101&type=1 |
| 上記ファンドCSV取得失敗時 | Yahoo!ファイナンスの公開「時系列」ページ（条件によって取得できない場合あり） | https://finance.yahoo.co.jp/quote/0331418A/history |

各社のデータ取得用URLやHTML構造は変わる場合があります。定期更新が絶対に成功する保証はありません。`yfinance`自体もYahoo!非公認で、研究・教育向けの個人使用を想定したプロジェクトです。**取得データをインターネット上で再公開してよいかは、データ提供元の利用条件や契約次第**です。不特定多数向けの公開サービスや商用利用には、再配信ライセンス付きの正式APIを利用してください。

## 現在の価格と更新時刻の違い

- **基準日**：実際の株価終値/基準価額の対象日。
- **更新日時**：GitHub Actionsが値を取得してJSONを書き出した日時。毎時更新を試みますが、同じ日付の終値や基準価額が続く場合があります。
- **ページ内「表示データを再読み込み」**：公開済みJSONをもう一度読み込むだけで、GitHub Actionsを起動する機能ではありません。
- **「取得失敗・保存値」**：最後に正常取得した価格を保存している状態です。
- 市場ごとに休日・時差があります。オルカンなど投資信託の基準価額は一日一回の公表で、株価の「リアルタイム」ではありません。

## 対象を変えるには

株式・指数のコードと名称は次の2ファイルをセットで編集します。

- `scripts/update_prices.py` の `STOCKS`／`FUNDS` 定義
- `public/app.js` の `CATALOG`／`SOURCE` 定義

SBIの**年1回決算型**に変えたい場合は、`8931224A`の識別子と対応するファンドCSV URL／運用会社リンクへ変更が必要です。

## ローカルで表示する

Pythonが入っていれば、サイトだけなら依存ライブラリ不要で表示できます。

```bash
cd market-watch-board/public
python3 -m http.server 8000
```

`http://localhost:8000/` を開きます。初期JSONが空の場合、価格は表示されません。実データを作るには、取得元への通信ができる環境で次を実行してください。

```bash
cd market-watch-board
python3 -m pip install -r requirements.txt
python3 scripts/update_prices.py
```

## 料金・制限

GitHub Freeの**公開リポジトリ**と標準GitHub-hosted runnerを使う場合、原則毎時23分（1日24回）のPages／Actionsの通常利用は無料です。ただしPagesは1サイト1GB・月100GB目安などの制限があり、GitHubは商用SaaS用のホスティングとして認めていません。スケジュールジョブは遅延・実行省略があり、公開リポジトリで60日間活動がないと自動無効化される可能性があります。

- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

**免責事項**：価格データと換算値は参考情報であり、投資判断や注文には取引先の公式価格を確認してください。このアプリは投資助言を行うものではありません。
