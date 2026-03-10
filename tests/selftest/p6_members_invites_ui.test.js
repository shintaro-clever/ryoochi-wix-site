const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers");

async function run() {
  const root = path.join(__dirname, "..", "..");
  const membersHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-members.html"), "utf8");
  const invitesHtml = fs.readFileSync(path.join(root, "apps/hub/static/ui/project-invites.html"), "utf8");

  assert(membersHtml.includes('data-layout="admin"'), "project-members should use admin layout");
  assert(membersHtml.includes('/admin/organizations') && membersHtml.includes('/members') && membersHtml.includes('/roles'), "project-members should load organizations, members, and roles from admin api");
  assert(membersHtml.includes('apiPatch(`/admin/organizations/${selectedOrganizationId}/members/${memberId}`'), "project-members should update member role/status");
  assert(membersHtml.includes("assigned_roles"), "project-members should render assigned roles");
  assert(membersHtml.includes("Responsibility Split"), "project-members should explain admin boundary separation");

  assert(invitesHtml.includes('data-layout="admin"'), "project-invites should use admin layout");
  assert(invitesHtml.includes('/admin/organizations') && invitesHtml.includes('/invites') && invitesHtml.includes('/roles'), "project-invites should load organizations, invites, and roles from admin api");
  assert(invitesHtml.includes("proposed_roles"), "project-invites should render proposed roles");
  assert(invitesHtml.includes("revoke"), "project-invites should provide revoke action");
  assert(invitesHtml.includes("招待状態"), "project-invites should describe invite status");
}

module.exports = { run };
