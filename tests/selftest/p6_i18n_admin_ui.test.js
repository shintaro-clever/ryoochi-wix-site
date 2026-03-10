const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const aiAdminHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/ai-admin.html"), "utf8");
  const knowledgeAdminHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/knowledge-admin.html"), "utf8");

  assert(aiAdminHtml.includes("/admin/i18n-policy"), "ai-admin should call i18n policy api");
  assert(aiAdminHtml.includes("Organization Language Policy"), "ai-admin should expose organization language policy section");
  assert(aiAdminHtml.includes("default_language") || aiAdminHtml.includes("Default Language"), "ai-admin should include default language control");
  assert(aiAdminHtml.includes("supported_languages") || aiAdminHtml.includes("Supported Languages"), "ai-admin should include supported languages control");
  assert(aiAdminHtml.includes("glossary_mode"), "ai-admin should include glossary mode control");

  assert(knowledgeAdminHtml.includes("Language Policy Boundary"), "knowledge-admin should explain i18n responsibility boundary");
  assert(knowledgeAdminHtml.includes("/ui/ai-admin.html"), "knowledge-admin should link to ai-admin for language policy editing");
}

module.exports = { run };
