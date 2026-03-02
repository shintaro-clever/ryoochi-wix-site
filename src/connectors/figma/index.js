const FIGMA_TOKEN_KEY = "figma_token";

function normalizeFigmaConfig(config = {}) {
  const token =
    typeof config[FIGMA_TOKEN_KEY] === "string"
      ? config[FIGMA_TOKEN_KEY].trim()
      : typeof config.token === "string"
        ? config.token.trim()
        : "";
  if (!token) {
    const error = new Error("figma token is required");
    error.status = 400;
    error.failure_code = "validation_error";
    throw error;
  }
  return {
    [FIGMA_TOKEN_KEY]: token,
    file_key: typeof config.file_key === "string" ? config.file_key.trim() : "",
  };
}

module.exports = {
  FIGMA_TOKEN_KEY,
  normalizeFigmaConfig,
};
