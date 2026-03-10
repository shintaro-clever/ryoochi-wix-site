function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

const GUARDED_CATEGORIES = Object.freeze([
  {
    code: "dangerous_operation",
    patterns: [
      /rm\s+-rf/i,
      /delete\s+production/i,
      /drop\s+database/i,
      /force\s+push/i,
      /本番.*削除/,
      /危険操作/,
    ],
    message: "危険操作の断定案内はできません。runbook と承認手順を確認してください。",
  },
  {
    code: "permission_change",
    patterns: [
      /rbac/i,
      /grant\s+admin/i,
      /change\s+permission/i,
      /権限変更/,
      /管理者権限/,
      /role\s+change/i,
    ],
    message: "権限変更の断定案内はできません。組織管理者または正式な権限手順へエスカレーションしてください。",
  },
  {
    code: "billing_judgment",
    patterns: [
      /billing/i,
      /refund/i,
      /charge/i,
      /invoice/i,
      /請求/,
      /返金/,
      /課金/,
    ],
    message: "請求判断は FAQ ボットの対象外です。正式な請求窓口または契約責任者へ確認してください。",
  },
  {
    code: "production_incident_diagnosis",
    patterns: [
      /production incident/i,
      /root cause/i,
      /outage/i,
      /sev[0-9]/i,
      /本番障害/,
      /障害原因/,
      /断定診断/,
    ],
    message: "本番障害の断定診断はできません。observability と runbook を確認し、必要なら運用者へエスカレーションしてください。",
  },
]);

function detectGuardrailCategory(text) {
  const source = normalizeText(text);
  if (!source) return null;
  return GUARDED_CATEGORIES.find((entry) => entry.patterns.some((pattern) => pattern.test(source))) || null;
}

function applyFaqGuardrails({ question = "", answer = "", confidence = "medium", escalation_hint = "" } = {}) {
  const source = [normalizeText(question), normalizeText(answer), normalizeText(escalation_hint)].filter(Boolean).join("\n");
  const hit = detectGuardrailCategory(source);
  if (!hit) {
    return {
      blocked: false,
      answer: normalizeText(answer),
      confidence: normalizeText(confidence) || "medium",
      escalation_hint: normalizeText(escalation_hint),
      guardrail_code: "",
    };
  }
  return {
    blocked: true,
    answer: hit.message,
    confidence: "low",
    escalation_hint: [normalizeText(escalation_hint), hit.message].filter(Boolean).join(" ").trim(),
    guardrail_code: hit.code,
  };
}

module.exports = {
  GUARDED_CATEGORIES,
  applyFaqGuardrails,
};
