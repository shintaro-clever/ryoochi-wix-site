const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const docPath = path.join(process.cwd(), "docs", "figma-validation-scoring.md");
  assert(fs.existsSync(docPath), "figma validation scoring doc should exist");
  const text = fs.readFileSync(docPath, "utf8");

  assert(text.includes("対象一致"), "scoring doc should include target match axis");
  assert(text.includes("構造再現"), "scoring doc should include structural axis");
  assert(text.includes("視覚再現"), "scoring doc should include visual axis");
  assert(text.includes("安全性"), "scoring doc should include safety axis");
  assert(text.includes("Total 100") || text.includes("合計 100点"), "scoring doc should define total 100");
  assert(text.includes("95点以上"), "scoring doc should define 95 points pass threshold");
  assert(text.includes("対象一致 < 100%"), "scoring doc should define target-match hard fail cutoff");
  assert(text.includes("安全性 < 95"), "scoring doc should define safety hard fail cutoff");
  assert(text.includes("status = \"ok\""), "scoring doc should define status=ok requirement");
  assert(text.includes("skipped"), "scoring doc should define skipped handling");
  assert(text.includes("error"), "scoring doc should define error handling");
  assert(text.includes("位置"), "scoring doc should include visual criterion: position");
  assert(text.includes("余白"), "scoring doc should include visual criterion: spacing");
  assert(text.includes("サイズ"), "scoring doc should include visual criterion: size");
  assert(text.includes("文字"), "scoring doc should include visual criterion: typography/text");
  assert(text.includes("色"), "scoring doc should include visual criterion: color");
  assert(text.includes("境界"), "scoring doc should include visual criterion: border");
  assert(text.includes("主要スタイル"), "scoring doc should include visual criterion: style");
  assert(text.includes("実務上の修正が最小限"), "scoring doc should define minimal practical rework condition");
  assert(text.includes("visual_fidelity_failed"), "scoring doc should define visual_fidelity_failed rule");
}

module.exports = { run };
