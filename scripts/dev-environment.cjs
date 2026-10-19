const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

// The checked-out project's local config is stable across PowerShell sessions.
// Other launchers/production retain their own environment handling.
function localEnvironment(root, inherited = process.env) {
  const file = path.join(root, ".env");
  const configured = fs.existsSync(file)
    ? parseEnv(fs.readFileSync(file, "utf8"))
    : {};
  const env = { ...inherited };
  const overridden = [];
  for (const [key, value] of Object.entries(configured)) {
    const existing = Object.keys(env).filter(
      (name) => name.toUpperCase() === key.toUpperCase(),
    );
    if (existing.some((name) => env[name] !== value)) overridden.push(key);
    for (const name of existing) if (name !== key) delete env[name];
    env[key] = value;
  }
  for (const key of ["AIC_FHI_POLICY_PATH", "AIC_INTERNATIONAL_POLICY_PATH", "AIC_STORAGE_DIR", "DOCLING_PYTHON", "DOCLING_ARTIFACTS_PATH"]) {
    if (env[key]) env[key] = path.resolve(root, env[key]);
  }
  return { env, overridden };
}

function aiEnvironment(source) {
  const provider = (source.AI_PROVIDER ?? "gemini").trim().toLowerCase();
  if (!["gemini", "deepseek", "agentrouter", "motapis"].includes(provider))
    throw new Error("AI_PROVIDER must be gemini or deepseek or agentrouter or motapis.");
  const prefix = {
    gemini: "GEMINI",
    deepseek: "DEEPSEEK",
    agentrouter: "AGENTROUTER",
    motapis: "MOTAPIS",
  }[provider];
  const keyName = prefix + "_API_KEY";
  if (!source[keyName]?.trim())
    throw new Error(
      `AI_PROVIDER=${provider} requires ${keyName} in the root .env.`,
    );
  const model =
    provider !== "gemini"
      ? (
          source[prefix + "_MODEL_ID"] ??
          ({agentrouter:"deepseek-v4-flash",motapis:"gpt-6-luna",deepseek:"deepseek-flash"}[provider])
        ).trim()
      : (
          source.GEMINI_MODEL_ID ||
          source.MODEL_ID ||
          "gemini-3.1-flash-lite"
        ).trim();
  if (!model.trim())
    throw new Error("The selected provider model must not be empty.");
  const selected = {
    ...Object.fromEntries(
      Object.entries(source).filter(([key]) => key.startsWith("AI_")),
    ),
    AI_PROVIDER: provider,
    [keyName]: source[keyName],
    [prefix + "_MODEL_ID"]: model,
    MODEL_ID: model,
    PROMPT_VERSION: source.PROMPT_VERSION || "",
    OCR_ENGINE: source.OCR_ENGINE || "provider",
    ...Object.fromEntries(
      ["OCR_LANG", "TESSERACT_CMD", "AIC_SAFE_PROVIDER_DIAGNOSTICS"]
        .filter((key) => source[key])
        .map((key) => [key, source[key]]),
    ),
  };
  if (selected.OCR_ENGINE === 'docling') {
    selected.DOCLING_PYTHON = source.DOCLING_PYTHON || path.resolve(__dirname,'../.venv-docling',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    selected.DOCLING_ARTIFACTS_PATH = source.DOCLING_ARTIFACTS_PATH || path.resolve(__dirname,'../data/local/docling/models');
    selected.DOCLING_ENGINE = source.DOCLING_ENGINE || 'easyocr';
    selected.DOCLING_LANG = source.DOCLING_LANG || 'vi,en';
    if (!['auto','easyocr','rapidocr','ocrmac'].includes(selected.DOCLING_ENGINE))
      throw new Error('Invalid DOCLING_ENGINE.');
  }
  if (provider !== "gemini") {
    const baseName = prefix + "_BASE_URL";
    const base =
      source[baseName] ||
      (provider === "agentrouter"
        ? "https://agentrouter.org/v1"
        : provider === "motapis" ? "https://motapis.com/v1" : "https://api.deepseek.com");
    let url;
    try {
      url = new URL(base);
    } catch {
      throw new Error(`Invalid ${baseName}.`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(provider !== "deepseek" ? ["/v1"] : ["", "/v1"]).includes(
        url.pathname.replace(/\/+$/, ""),
      )
    )
      throw new Error(
        `Invalid ${baseName}; use an HTTPS API base without credentials or query options.`,
      );
    selected[baseName] = base.replace(/\/+$/, "");
  }
  if (["agentrouter", "motapis"].includes(provider)) {
    const setting = prefix + "_VISION_ENABLED";
    const vision = source[setting] ?? "0";
    if (!["0", "1"].includes(vision))
      throw new Error(`${setting} must be 0 or 1.`);
    selected[setting] = vision;
  }
  return selected;
}

module.exports = { localEnvironment, aiEnvironment };
