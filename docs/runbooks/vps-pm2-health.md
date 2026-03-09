# VPS PM2 Health & Process Management (OPS-PM2-01)

## Purpose
- PM2 プロセスの正常性確認手順を定義する。
- 残骸プロセス・起動スクリプト乖離・クラッシュループの検出と対処を標準化する。

---

## 正本プロセス定義

| pm2 name | script | port | 用途 |
|---|---|---|---|
| `integration-hub-web` | `server.js` | 3000 (127.0.0.1) | 本番Web+API統合サーバー |
| `integration-hub-test` | — | 3100 (127.0.0.1) | テスト用（意図的残存） |

- nginx は **3000 (`integration-hub-web`) のみ** にトラフィックを向ける。
- `ecosystem.config.cjs` の `name` は `integration-hub-web` を正とする。
- `integration-hub` という名前のプロセスが pm2 に存在する場合は残骸と判断して削除する。

---

## 定期ヘルスチェック手順

```bash
# 1. 接続確認（必須・最初に実行）
bin/vps 'echo connected'

# 2. プロセス一覧確認
bin/vps 'pm2 list'

# 3. 本番プロセス詳細確認
bin/vps 'pm2 describe integration-hub-web | grep -E "status|script path|uptime|restart"'

# 4. nginx 応答確認
curl -sI https://hub.test-plan.help | head -15
```

**正常状態の期待値:**

```
integration-hub-web : status=online, script=server.js, unstable_restarts=0
HTTP 302/200, Strict-Transport-Security: max-age=31536000 が含まれる
```

---

## 異常パターンと対処

### パターン1: pm2 に `integration-hub` が存在して errored / stopped

```
原因: ecosystem.config.cjs 更新前の残骸プロセス（api-server.js を向いている）
対処: pm2 delete integration-hub && pm2 save
確認: pm2 list に integration-hub が消えていること
```

過去の事例（2026-03-04）: `SECRET_KEY is invalid: must be 64-char hex` で 85回クラッシュした後 errored 状態で放置されていた。nginx には繋がっておらず実トラフィックへの影響はなかったが、誤再起動・誤監視のリスクがあった。

### パターン2: `integration-hub-web` が stopped / errored

```
確認: pm2 logs integration-hub-web --lines 50 --nostream
対処: 原因確認後、pm2 restart integration-hub-web
   または: cd /srv/integration-hub && pm2 start ecosystem.config.cjs
```

### パターン3: pm2 start ecosystem.config.cjs が `integration-hub` という名前でプロセスを作ってしまう

```
原因: ecosystem.config.cjs の name が古いまま（integration-hub）
対処: ecosystem.config.cjs の name を integration-hub-web に修正してから再実行
```

---

## nginx セキュリティヘッダ確認

VPS 反映後は必ず以下で確認する:

```bash
curl -sI https://hub.test-plan.help | grep -E "Strict-Transport|X-Frame|X-Content|Referrer|Server:"
```

**期待レスポンス:**

```
Server: nginx                               # バージョン非表示
Strict-Transport-Security: max-age=31536000
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

入口側（`server_name _` の default_server）も nginx -t で構文エラーがないことを確認する。

---

## SQLite 権限確認

```bash
bin/vps 'stat /srv/integration-hub/.hub/hub.sqlite | grep "Access:.*Uid"'
# 期待: (0600/-rw-------)
```

**注意**: `-wal` / `-shm` はアプリが書き込む際に再生成される場合があり、その際に権限が 644 に戻ることがある（umask 依存）。恒久解決には pm2 起動経路での `umask 0077` 設定が必要。現時点は「当面安全」の状態として管理し、将来の対応候補に残す。

---

## 参照
- `agents/rules/10-network.md`
- `docs/runbooks/vps-external-operations-checklist.md`
