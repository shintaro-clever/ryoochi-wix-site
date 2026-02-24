#!/usr/bin/env node
const fs = require("fs");

function fail(msg) {
  console.error(`[pr-body-verify] FAIL: ${msg}`);
  process.exit(1);
}

const file = process.argv[2] || "/tmp/pr.md";
if (!fs.existsSync(file)) fail(`missing file: ${file}`);
const body = fs.readFileSync(file, "utf8");

const requiredHeadings = ["## 概要", "## 変更内容（AIが埋める）", "## 関連Issue（どちらか1つチェック）", "## 完了条件（最低1つチェック）", "## 補足（任意）"];
for (const h of requiredHeadings) {
  if (!body.includes(h)) fail(`missing heading: ${h}`);
}

const issueChecks = (body.match(/## 関連Issue（どちらか1つチェック）[\s\S]*?\n## /) || [body])[0];
const issueChecked = (issueChecks.match(/- \[x\]/g) || []).length;
if (issueChecked !== 1) fail(`関連Issue section must have exactly 1 checked item, got=${issueChecked}`);

const acSection = (body.match(/## 完了条件（最低1つチェック）[\s\S]*?\n## /) || [body])[0];
const acChecked = (acSection.match(/- \[x\]/g) || []).length;
if (acChecked < 1) fail(`完了条件 section must have >=1 checked item, got=${acChecked}`);

console.log("[pr-body-verify] OK");
