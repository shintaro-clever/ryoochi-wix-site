const { listProjects: listProjectsRaw, getProject: getProjectRaw } = require("../api/projects");

function toProjectView(row) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const projectId = typeof row.id === "string" && row.id ? row.id : String(row.project_id || "");
  const status = typeof row.status === "string" && row.status ? row.status : "active";
  const owner = typeof row.owner === "string" && row.owner ? row.owner : null;
  const updatedAt = typeof row.updated_at === "string" && row.updated_at ? row.updated_at : null;
  const createdAt = typeof row.created_at === "string" && row.created_at ? row.created_at : null;
  const description = typeof row.description === "string" ? row.description : "";
  const stagingUrl = typeof row.staging_url === "string" ? row.staging_url : "";
  const driveFolderId = typeof row.drive_folder_id === "string" && row.drive_folder_id ? row.drive_folder_id : null;

  return {
    project_id: projectId,
    id: projectId,
    name: typeof row.name === "string" ? row.name : "",
    status,
    updated_at: updatedAt,
    owner,
    description,
    staging_url: stagingUrl,
    drive_folder_id: driveFolderId,
    created_at: createdAt,
    meta: {
      description,
      staging_url: stagingUrl,
      drive_folder_id: driveFolderId,
    },
  };
}

function loadProjects(db) {
  const rows = listProjectsRaw(db);
  return Array.isArray(rows) ? rows : [];
}

function listProjects(db) {
  return {
    projects: loadProjects(db).map((row) => toProjectView(row)).filter(Boolean),
  };
}

function getProjectById(db, projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    return null;
  }
  return toProjectView(getProjectRaw(db, projectId.trim()));
}

module.exports = {
  loadProjects,
  listProjects,
  getProjectById,
};

