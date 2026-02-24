# MS2 方針ドキュメント

以下の方針で MS2（Run 基本機能）を実装する。対象スコープは Run の起動／遷移／タイムアウト／artifacts／events／ポーリングのみとし、capability 事前チェック・Job テンプレート・Preflight・autoRoute は MS2.5 で実装する。

1. `RUN_TIMEOUT_MS` 環境変数で Run の実行時間上限を上書きできるようにする（デフォルト値は 1,800,000 ミリ秒 = 30 分）。
2. ポーリングは Run 詳細画面を表示している間のみ 3 秒間隔で実施し、Run が `succeeded` / `failed` / `cancelled` になった時点で自動停止する。
3. failure_code は MS0-04 で定義された固定 13 種のみを使用し、新たな failure_code を追加しない。

※ 上記方針に含まれない拡張（capability 事前チェック／Job テンプレート／Preflight／autoRoute）は MS2.5 のタスクとする。
