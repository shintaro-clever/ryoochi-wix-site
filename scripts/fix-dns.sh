#!/usr/bin/env bash
# fix-dns.sh — コンテナ再起動後に /etc/resolv.conf をリストアする
# postStartCommand から呼び出される（毎回実行）

set -e

RESOLV=/etc/resolv.conf

fix_resolv() {
  sudo sh -c "cat > ${RESOLV} <<'EOF'
nameserver 1.1.1.1
nameserver 8.8.8.8
options timeout:1 attempts:2
EOF"
  echo "[fix-dns] /etc/resolv.conf を修正しました"
}

# 現在の resolv.conf を確認
CURRENT=$(cat "${RESOLV}" 2>/dev/null || echo "")
if echo "${CURRENT}" | grep -qE "^nameserver (1\.1\.1\.1|8\.8\.8\.8)"; then
  echo "[fix-dns] DNS は正常です（変更不要）"
  exit 0
fi

echo "[fix-dns] DNS が不正な状態です。修正を試みます..."
echo "[fix-dns] 現在の状態: $(echo "${CURRENT}" | grep nameserver || echo '(nameserverなし)')"
fix_resolv

# 修正後確認
if curl -fsSI -o /dev/null --max-time 5 https://github.com 2>/dev/null; then
  echo "[fix-dns] 疎通確認 OK (github.com)"
else
  echo "[fix-dns] 警告: github.com への疎通に失敗しました。ネットワーク設定を確認してください。"
fi
