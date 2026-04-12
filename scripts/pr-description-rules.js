#!/usr/bin/env node

function extractSection(text, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  const match = text.match(re);
  if (!match || typeof match.index !== "number") return "";
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.match(/\n##\s+/m);
  return next ? rest.slice(0, next.index) : rest;
}

function sectionLines(section) {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function bulletLines(section) {
  return sectionLines(section).filter((line) => line.startsWith("- ") && !line.includes("（AI）"));
}

function extractDescriptionFromChangeBullet(line) {
  const content = line.replace(/^-+\s*/, "");
  const separatorIndex = content.indexOf(":");
  if (separatorIndex === -1) return "";
  return content.slice(separatorIndex + 1).trim();
}

function hasMeaningfulChangeDescription(line) {
  const description = extractDescriptionFromChangeBullet(line);
  if (!description) return false;
  const compact = description
    .replace(/`[^`]*`/g, " ")
    .replace(/[。、「」、,.!！?？:：;；()[\]{}'"`~\-_/\\|]/g, " ")
    .replace(/\s+/g, "");
  if (compact.length < 8) return false;
  return /[A-Za-z0-9\u3040-\u30ff\u4e00-\u9fff]/.test(compact);
}

function validatePrDescription(body) {
  const errors = [];
  const lines = body.split(/\r?\n/);

  const requiredHeadings = [
    "概要",
    "変更内容（AIが埋める）",
    "関連Issue（どちらか1つチェック）",
    "完了条件（最低1つチェック）",
  ];

  for (const heading of requiredHeadings) {
    if (!body.includes(`## ${heading}`)) {
      errors.push(`必須見出しが不足: ## ${heading}`);
    }
  }

  if (body.includes("（AI）")) {
    errors.push("プレースホルダー（（AI））が残っています");
  }

  const overviewSection = extractSection(body, "概要");
  const changesSection = extractSection(body, "変更内容（AIが埋める）");
  const issueSection = extractSection(body, "関連Issue（どちらか1つチェック）");
  const completionSection = extractSection(body, "完了条件（最低1つチェック）");
  const supplementSection = extractSection(body, "補足（任意）");

  const overviewBullets = bulletLines(overviewSection);
  if (overviewBullets.length === 0) {
    errors.push("「概要」が空です。PR の狙いを 1 行で書いてください。");
  }

  const changeBullets = bulletLines(changesSection);
  if (changeBullets.length < 3 || changeBullets.length > 7) {
    errors.push("「変更内容」は 3〜7 行の bullet で書いてください。");
  }
  if (changeBullets.some((line) => !line.includes(":"))) {
    errors.push("「変更内容」は各 bullet を「項目名: 何をどう変えたか」の形式で書いてください。");
  }
  if (changeBullets.some((line) => line.includes(":") && !hasMeaningfulChangeDescription(line))) {
    errors.push("「変更内容」の説明が短すぎるか、中身がありません。最低限「何をどう変えたか」が読める形で書いてください。");
  }
  if (!changeBullets.some((line) => /^-\s*影響範囲\s*:/.test(line))) {
    errors.push("「変更内容」には「影響範囲: ...」の bullet を含めてください。");
  }
  if (!changeBullets.some((line) => /^-\s*リスク\s*:/.test(line))) {
    errors.push("「変更内容」には「リスク: ...」の bullet を含めてください。");
  }

  const isChecked = (line) => /^\s*-\s+\[[xX]\]\s+/.test(line);
  const relatedIssueChecked = lines.some((line) => isChecked(line) && /関連Issueあり:/i.test(line));
  const noIssueChecked = lines.some((line) => isChecked(line) && /\bNo\s*Issue\b/i.test(line));
  if (!relatedIssueChecked && !noIssueChecked) {
    errors.push("「関連Issueあり（#番号）」または「No Issue（理由）」のどちらかをチェックしてください。");
  }
  if (relatedIssueChecked && noIssueChecked) {
    errors.push("「関連Issueあり」と「No Issue」は同時にチェックしないでください。");
  }
  if (relatedIssueChecked && !/#\d+/.test(issueSection)) {
    errors.push("「関連Issueあり」をチェックした場合は #番号（例: #12）を含めてください。");
  }
  if (noIssueChecked && /<[^>]+>/.test(issueSection)) {
    errors.push("「No Issue」の理由がプレースホルダーのままです。");
  }

  const completionChecked = sectionLines(completionSection).filter((line) => /^\s*-\s+\[[xX]\]\s+AC:\s*\S+/.test(line));
  if (completionChecked.length === 0) {
    errors.push("「完了条件」は少なくとも 1 つを [x] にし、AC の内容を埋めてください。");
  }

  if (supplementSection.includes("（AI）")) {
    errors.push("「補足（任意）」にプレースホルダーが残っています。");
  }

  return { errors };
}

module.exports = { validatePrDescription };
