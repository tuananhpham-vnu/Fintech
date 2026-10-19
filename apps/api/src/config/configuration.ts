import * as path from "path";
import type { FoundationConfig } from "../foundation/ports";
import { loadFhiPolicy } from "../financial/fhi-policy";
import { loadInternationalPolicy } from '../financial/accounting-profiles';

/** Transport-only configuration: legacy client unit tests do not require a DB. */
export function loadAiTransportConfig() {
  const aiServiceUrl = (
    process.env.AIC_AI_SERVICE_URL || "http://127.0.0.1:8100"
  ).replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(aiServiceUrl);
  } catch {
    throw new Error("Invalid AIC_AI_SERVICE_URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid AIC_AI_SERVICE_URL");
  const internalApiKey = process.env.INTERNAL_API_KEY || "test_internal_key";
  if (
    process.env.NODE_ENV === "production" &&
    (internalApiKey === "test_internal_key" ||
      !/^[\x21-\x7e]{32,512}$/.test(internalApiKey))
  )
    throw new Error("AI transport requires a non-default production key");
  return { aiServiceUrl, internalApiKey };
}

export interface AppConfig extends FoundationConfig {
  port: number;
  frontendOrigin: string;
  storageDir: string;
  aiServiceUrl: string;
  internalApiKey: string;
  cookieName: string;
  sessionTtlMs: number;
  nodeEnv: string;
  isProduction: boolean;
  runtimeMode: "foundation" | "prototype";
  documentRuntime?: "local" | "production";
  documentAiMode?: "live" | "mock";
}

export function loadConfig(): AppConfig {
  const rootDir = path.resolve(__dirname, "../../../..");
  const positive = (name: string, fallback?: number) => {
    const raw = process.env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`Invalid ${name} configuration`);
    return value;
  };
  const port = positive("PORT", 3001);
  if (port > 65535) throw new Error("Invalid PORT configuration");
  const nodeEnv = process.env.NODE_ENV || "development";
  const documentRuntime = process.env.AIC_DOCUMENT_RUNTIME;
  if (
    documentRuntime !== undefined &&
    !["local", "production"].includes(documentRuntime)
  )
    throw new Error("Invalid AIC_DOCUMENT_RUNTIME");
  if (documentRuntime === "local" && nodeEnv === "production")
    throw new Error("Document runtime has local acceptance only");
  const documentAiMode = process.env.AIC_DOCUMENT_AI_MODE;
  if (documentRuntime && documentAiMode !== "mock" && documentAiMode !== "live")
    throw new Error("Explicit AIC_DOCUMENT_AI_MODE required");
  const runtimeMode = process.env.AIC_RUNTIME_MODE || "foundation";
  if (runtimeMode !== "foundation" && runtimeMode !== "prototype")
    throw new Error("Invalid AIC_RUNTIME_MODE");
  if (
    runtimeMode === "prototype" &&
    (nodeEnv !== "test" || process.env.AIC_ENABLE_PROTOTYPE !== "true")
  ) {
    throw new Error(
      "Prototype requires NODE_ENV=test and explicit AIC_ENABLE_PROTOTYPE=true",
    );
  }

  const aiServiceUrl = (
    process.env.AIC_AI_SERVICE_URL || "http://127.0.0.1:8100"
  ).replace(/\/$/, "");
  const aiUrl = new URL(aiServiceUrl);
  if (
    !["http:", "https:"].includes(aiUrl.protocol) ||
    aiUrl.username ||
    aiUrl.password ||
    aiUrl.search ||
    aiUrl.hash
  )
    throw new Error("Invalid AIC_AI_SERVICE_URL");

  const storageDir =
    process.env.AIC_STORAGE_DIR || path.join(rootDir, "storage");
  const internalApiKey = process.env.INTERNAL_API_KEY || "test_internal_key";
  if (
    nodeEnv === "production" &&
    (internalApiKey === "test_internal_key" ||
      !/^[\x21-\x7e]{32,512}$/.test(internalApiKey))
  ) {
    throw new Error(
      "INTERNAL_API_KEY cannot use test default in production environment",
    );
  }

  const databaseUrl = process.env.DATABASE_URL || "";
  if (runtimeMode === "foundation") {
    if (!databaseUrl)
      throw new Error("DATABASE_URL is required; no in-memory fallback");
    let parsed: URL;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      throw new Error("Invalid DATABASE_URL");
    }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol))
      throw new Error("Invalid DATABASE_URL");
  }
  const frontendOrigin =
    process.env.AIC_FRONTEND_ORIGIN || "http://127.0.0.1:3000";
  const origin = new URL(frontendOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Invalid AIC_FRONTEND_ORIGIN");
  if (nodeEnv === "production" && origin.protocol !== "https:")
    throw new Error("Production frontend requires HTTPS");
  const cookieName = process.env.AIC_COOKIE_NAME || "aic_fe_qa";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cookieName))
    throw new Error("Invalid AIC_COOKIE_NAME");
  const config: AppConfig = {
    fhiPolicy: loadFhiPolicy(process.env.AIC_FHI_POLICY_PATH),
    internationalPolicy: loadInternationalPolicy(process.env.AIC_INTERNATIONAL_POLICY_PATH),
    port,
    frontendOrigin: origin.origin,
    allowedOrigins:
      nodeEnv === "production"
        ? [origin.origin]
        : [
            ...new Set([
              origin.origin,
              origin.origin.replace("//127.0.0.1:", "//localhost:"),
              origin.origin.replace("//localhost:", "//127.0.0.1:"),
            ]),
          ],
    storageDir: path.resolve(storageDir),
    aiServiceUrl,
    internalApiKey,
    cookieName,
    databaseUrl,
    secureCookies: nodeEnv === "production",
    sessionTtlMs: positive("AIC_SESSION_TTL_MS", 8 * 3600 * 1000),
    sessionIdleMs: positive("AIC_SESSION_IDLE_MS", 30 * 60 * 1000),
    loginMaxAttempts: positive("AIC_LOGIN_MAX_FAILURES", 5),
    loginWindowMs: positive("AIC_LOGIN_WINDOW_MS", 15 * 60 * 1000),
    loginBlockMs: positive("AIC_LOGIN_BLOCK_MS", 15 * 60 * 1000),
    idempotencyTtlMs: positive(
      "AIC_IDEMPOTENCY_TTL_MS",
      runtimeMode === "prototype" || documentRuntime === "local"
        ? 86400000
        : undefined,
    ),
    runtimeMode,
    documentRuntime: documentRuntime as "local" | "production" | undefined,
    documentAiMode: documentAiMode as "live" | "mock" | undefined,
    nodeEnv,
    isProduction: nodeEnv === "production",
    invitationTtlMs: positive("AIC_INVITATION_TTL_MS", 3600000),
    respondentRequestsPerMinute: positive(
      "AIC_RESPONDENT_REQUESTS_PER_MINUTE",
      120,
    ),
  };
  assertDocumentRuntime(config);
  return config;
}

/** Promotion is explicit; a local harness can never become a production process by injection. */
export function assertDocumentRuntime(config: AppConfig): void {
  if (!config.documentRuntime) return;
  const productionProcess =
    config.isProduction ||
    config.nodeEnv === "production" ||
    process.env.NODE_ENV === "production";
  if (productionProcess && config.documentRuntime !== "production")
    throw new Error("Local document runtime cannot run in production");
  if (
    config.documentRuntime === "production" &&
    (!config.isProduction ||
      config.nodeEnv !== "production" ||
      config.runtimeMode !== "foundation" ||
      config.documentAiMode !== "live" ||
      !config.secureCookies ||
      new URL(config.frontendOrigin).protocol !== "https:" ||
      !config.databaseUrl ||
      config.internalApiKey === "test_internal_key" ||
      !/^[\x21-\x7e]{32,512}$/.test(config.internalApiKey) ||
      !path.isAbsolute(config.storageDir) ||
      !process.env.AIC_STORAGE_DIR)
  )
    throw new Error(
      "Production documents require live AI, HTTPS, private storage, database and non-default service authentication",
    );
}
