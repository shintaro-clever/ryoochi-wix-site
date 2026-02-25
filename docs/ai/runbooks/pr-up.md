# PR Up Runbook

## 正しい手順（固定）

1. `node scripts/hub-doctor.js`
2. `npm test`
3. `node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator`（status=ok）
4. `node scripts/pr-up.js`

## pr-up のガード優先順位

1. DNS/NET
2. native ABI
3. offline smoke
4. diffゼロ
5. 実行（npm test / push / gh）

## DNSが揺れる環境の恒久化

`/etc/resolvconf/resolv.conf.d/head` に固定DNSを入れて再生成で戻らないようにする。

```bash
sudo mkdir -p /etc/resolvconf/resolv.conf.d
echo "nameserver 1.1.1.1" | sudo tee /etc/resolvconf/resolv.conf.d/head
echo "nameserver 8.8.8.8" | sudo tee -a /etc/resolvconf/resolv.conf.d/head
sudo resolvconf -u
```

## よくある落ち方と復旧（1ブロック）

```bash
# DNS/NET
sudo sh -c 'cat > /etc/resolv.conf <<EOF
nameserver 1.1.1.1
nameserver 8.8.8.8
options timeout:1 attempts:2
EOF'

# native ABI
volta pin node@22
rm -rf node_modules
npm install

# offline smoke
node scripts/run-job.js --job scripts/sample-job.mcp.offline.smoke.json --role operator

# 再実行
node scripts/pr-up.js
```
