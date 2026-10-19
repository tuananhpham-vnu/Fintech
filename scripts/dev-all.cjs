const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawnSync } = require("node:child_process");
const { prepareLocalDatabase, validateTargets } = require("./dev-prepare.cjs");
const { localEnvironment, aiEnvironment } = require("./dev-environment.cjs");

const ROOT = path.resolve(__dirname, "..");

const { env, overridden } = localEnvironment(ROOT);
if (overridden.length)
  console.log(
    `[PREP] Using root .env instead of terminal overrides: ${overridden.join(", ")}`,
  );

const PYTHON_EXEC =
  process.platform === "win32"
    ? path.join(ROOT, ".venv", "Scripts", "python.exe")
    : path.join(ROOT, ".venv", "bin", "python");

const STORAGE_DIR = env.AIC_STORAGE_DIR || "C:/private/aic-mvp-cache";
const INTERNAL_KEY = env.INTERNAL_API_KEY;
const DB_URL = env.DATABASE_URL;
const API_DB_URL = env.AIC_API_DATABASE_URL || DB_URL;
const WORKER_DB_URL = env.AIC_WORKER_DATABASE_URL || DB_URL;
let selectedAiEnv;
try {
  selectedAiEnv = aiEnvironment(env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const builtWeb = process.argv.includes("--built-web");
const checkOnly = process.argv.includes("--check");
if (
  process.argv.slice(2).some((arg) => !["--built-web", "--check"].includes(arg))
)
  throw new Error("Supported options: --built-web, --check");
const systemEnv = Object.fromEntries(
  Object.entries(env).filter(([key]) =>
    /^(PATH|SystemRoot|WINDIR|TEMP|TMP|LANG|LC_ALL|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|COMSPEC|PATHEXT|HOME)$/i.test(
      key,
    ),
  ),
);
const apiEnv = {
  ...systemEnv,
  ...Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        key.startsWith("AIC_") &&
        !["AIC_API_DATABASE_URL", "AIC_WORKER_DATABASE_URL"].includes(key),
    ),
  ),
};
if (!INTERNAL_KEY || !DB_URL || !API_DB_URL || !WORKER_DB_URL) {
  console.error(
    "AIC startup requires DATABASE_URL and INTERNAL_API_KEY in the root .env; no services were started.",
  );
  process.exit(1);
}

// ANSI colors for clean log separation
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  ai: "\x1b[33m", // Yellow
  api: "\x1b[36m", // Cyan
  worker: "\x1b[35m", // Magenta
  web: "\x1b[32m", // Green
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

function pipeOutput(proc, name, color) {
  const handleChunk = (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().length > 0) {
        console.log(`${color}${colors.bold}[${name}]${colors.reset} ${line}`);
      }
    }
  };
  proc.stdout?.on("data", handleChunk);
  proc.stderr?.on("data", handleChunk);
  proc.once("error", () => {
    console.error(
      `[${name}] Failed to start. Check configuration and required build files.`,
    );
    cleanup();
    process.exitCode = 1;
  });
  proc.once("exit", () => {
    if (stopping) return;
    console.error(
      `[${name}] Service exited; stopping this launch's remaining processes.`,
    );
    cleanup();
    process.exitCode = 1;
  });
}

const processes = [];
let stopping = false;

function cleanup() {
  if (stopping) return;
  stopping = true;
  console.log(
    `\n${colors.red}${colors.bold}Stopping all services...${colors.reset}`,
  );
  for (const p of processes) {
    if (p.exitCode !== null || p.signalCode !== null) continue;
    try {
      if (process.platform === "win32" && p.pid) {
        spawn("taskkill", ["/pid", p.pid.toString(), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else if (p.kill) {
        p.kill("SIGTERM");
      }
    } catch {}
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

function pnpmCommand(args) {
  const entry = process.env.npm_execpath;
  if (entry && fs.existsSync(entry))
    return [process.execPath, [entry, ...args], false];
  return [
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
    process.platform === "win32",
  ];
}

function runPreparation(file, args, shell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: ROOT,
      env: systemEnv,
      stdio: "inherit",
      shell,
      windowsHide: true,
    });
    processes.push(child);
    child.once("error", () =>
      reject(
        new Error(
          "Development preparation could not start; check the installed runtimes.",
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0 && !stopping
        ? resolve()
        : reject(
            new Error(
              "Development preparation failed; no services were started.",
            ),
          ),
    );
  });
}

async function waitReady(name, url) {
  const deadline = Date.now() + 60_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      await response.body?.cancel();
      if (response.ok) {
        console.log(`[READY] ${name}`);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `${name} did not become ready; check the service logs above.`,
  );
}

async function start() {
  console.log(
    `[PREP] AI provider: ${selectedAiEnv.AI_PROVIDER}; model: ${selectedAiEnv.MODEL_ID}`,
  );
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "dev:all is for local development; production migrations require the explicit runner.",
    );
  validateTargets(DB_URL, API_DB_URL, WORKER_DB_URL, env);
  if (!checkOnly && !fs.existsSync(PYTHON_EXEC))
    throw new Error(
      "Python .venv is missing; create the project virtual environment first.",
    );
  if (
    !checkOnly &&
    builtWeb &&
    !fs.existsSync(path.join(ROOT, "apps/web/.next/BUILD_ID"))
  )
    throw new Error(
      "Built web is missing; run pnpm build, or use pnpm dev:all for development.",
    );
  if (!checkOnly) {
    await Promise.all(
      [3000, 3001, 8100].map(
        (port) =>
          new Promise((resolve, reject) => {
            const probe = net.createServer();
            probe.once("error", () =>
              reject(
                new Error(
                  `Port ${port} is already in use; no services were started.`,
                ),
              ),
            );
            probe.listen(port, "127.0.0.1", () => probe.close(resolve));
          }),
      ),
    );
    console.log("[PREP] Checking AI dependencies...");
    const requirements = spawnSync(
      PYTHON_EXEC,
      [
        "-c",
        [
          "import sys,tomllib,importlib.metadata as m",
          "from pip._vendor.packaging.requirements import Requirement",
          "deps=tomllib.load(open('services/ai/pyproject.toml','rb'))['project']['dependencies']",
          "try:",
          " for item in deps:",
          "  r=Requirement(item)",
          "  if not r.marker or r.marker.evaluate():",
          "   if m.version(r.name) not in r.specifier: sys.exit(1)",
          "except m.PackageNotFoundError: sys.exit(1)",
        ].join("\n"),
      ],
      {
        cwd: ROOT,
        env: systemEnv,
        stdio: "ignore",
        windowsHide: true,
        timeout: 15_000,
      },
    );
    if (requirements.status !== 0) {
      console.log(
        "[PREP] Installing the AI dependencies declared in pyproject.toml...",
      );
      await runPreparation(PYTHON_EXEC, [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--quiet",
        "--no-input",
        "-e",
        "services/ai",
      ]);
    }
  }
  console.log("[PREP] Building the current API source...");
  await runPreparation(...pnpmCommand(["api:build"]));
  const apiRuntimeEnv = {
    ...apiEnv,
    PORT: "3001",
    NODE_ENV: "development",
    AIC_RUNTIME_MODE: "foundation",
    AIC_DOCUMENT_RUNTIME: "local",
    AIC_DOCUMENT_AI_MODE: "live",
    AIC_STORAGE_DIR: STORAGE_DIR,
    INTERNAL_API_KEY: INTERNAL_KEY,
    AIC_AI_SERVICE_URL: "http://127.0.0.1:8100",
    AIC_FRONTEND_ORIGIN: "http://127.0.0.1:3000",
    AIC_IDEMPOTENCY_TTL_MS: "86400000",
    DATABASE_URL: API_DB_URL,
  };
  console.log("[PREP] Validating API configuration...");
  const configCheck = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const {loadConfig}=require('./dist/config/configuration.js');
    const {startupFailure}=require('./dist/config/startup-diagnostics.js');
    try { loadConfig(); }
    catch(error) { process.stderr.write(startupFailure(error,'CONFIG')); process.exitCode=1; }
  `,
    ],
    {
      cwd: path.join(ROOT, "apps/api"),
      env: apiRuntimeEnv,
      stdio: "inherit",
      windowsHide: true,
      timeout: 15_000,
    },
  );
  if (configCheck.status !== 0)
    throw new Error(
      "API configuration check failed; no services were started.",
    );
  const aiRuntimeEnv = {
    ...systemEnv,
    ...selectedAiEnv,
    INTERNAL_API_KEY: INTERNAL_KEY,
    AI_STORAGE_DIR: STORAGE_DIR,
    AI_MODE: "live",
    AI_LOAD_DOTENV: "0",
    ENABLE_TEST_CONSOLE: "0",
  };
  console.log("[PREP] Validating AI provider configuration (no API call)...");
  const providerCheck = spawnSync(
    PYTHON_EXEC,
    [
      "-c",
      [
        "import sys",
        "from providers.factory import create_provider",
        "try:",
        " provider=create_provider()",
        " provider.close()",
        " import os",
        " if os.environ.get('OCR_ENGINE') == 'docling':",
        "  from extraction import Config",
        "  from extraction.ocr import DoclingOcr",
        "  cfg=Config.from_env()",
        "  DoclingOcr(cfg.docling_python,cfg.docling_engine,cfg.docling_lang,cfg.docling_artifacts)",
        "except Exception:",
        " print('AI/OCR configuration failed; check the selected provider and run pnpm ai:ocr:setup for Docling.',file=sys.stderr)",
        " sys.exit(1)",
      ].join("\n"),
    ],
    {
      cwd: path.join(ROOT, "services/ai"),
      env: aiRuntimeEnv,
      stdio: "inherit",
      windowsHide: true,
      timeout: 15_000,
    },
  );
  if (providerCheck.status !== 0)
    throw new Error("AI configuration check failed; no services were started.");
  if (checkOnly) {
    console.log(
      "[PREP] API and AI configurations are valid; no services were started.",
    );
    return;
  }
  await prepareLocalDatabase({
    root: ROOT,
    ownerUrl: DB_URL,
    apiUrl: API_DB_URL,
    workerUrl: WORKER_DB_URL,
    env,
  });
  if (stopping) return;
  console.log(
    `${colors.bold}====================================================${colors.reset}`,
  );
  console.log(`${colors.bold}Starting AIC Services...${colors.reset}`);
  console.log(
    `- ${colors.web}[WEB]${colors.reset}    Next.js   : http://127.0.0.1:3000`,
  );
  console.log(
    `- ${colors.api}[API]${colors.reset}    NestJS    : http://127.0.0.1:3001`,
  );
  console.log(
    `- ${colors.ai}[AI]${colors.reset}     FastAPI   : http://127.0.0.1:8100`,
  );
  console.log(
    `- ${colors.worker}[WORKER]${colors.reset} Doc Worker: Polling jobs`,
  );
  console.log(
    `- ${colors.worker}[DOSSIER]${colors.reset} ZIP Worker: Polling intake/extraction`,
  );
  console.log(
    `- ${colors.worker}[FINANCIAL]${colors.reset} BCTC Worker: Polling financial intake`,
  );
  console.log(
    `${colors.gray}Press Ctrl+C to terminate all services.${colors.reset}`,
  );
  console.log(
    `${colors.bold}====================================================\n${colors.reset}`,
  );

  // 1. AI Service (Python FastAPI)
  if (fs.existsSync(PYTHON_EXEC)) {
    const aiProc = spawn(
      PYTHON_EXEC,
      ["-m", "runner", "serve", "--port", "8100"],
      {
        cwd: path.join(ROOT, "services", "ai"),
        env: aiRuntimeEnv,
      },
    );
    pipeOutput(aiProc, "AI", colors.ai);
    processes.push(aiProc);
  } else {
    console.log(
      `${colors.red}[AI] Python virtual environment not found at ${PYTHON_EXEC}${colors.reset}`,
    );
  }

  await waitReady("AI", "http://127.0.0.1:8100/healthz");
  // 2. Backend API (NestJS)
  const apiDist = path.join(ROOT, "apps", "api", "dist", "main.js");
  if (fs.existsSync(apiDist)) {
    const apiProc = spawn(process.execPath, [apiDist], {
      cwd: path.join(ROOT, "apps", "api"),
      env: apiRuntimeEnv,
    });
    pipeOutput(apiProc, "API", colors.api);
    processes.push(apiProc);
  } else {
    console.log(
      `${colors.red}[API] Dist not found at ${apiDist}. Run 'pnpm api:build' first.${colors.reset}`,
    );
  }

  await waitReady(
    "API / PostgreSQL",
    "http://127.0.0.1:3001/api/v2/health/ready",
  );
  // 3. Document Worker
  const workerDist = path.join(
    ROOT,
    "apps",
    "api",
    "dist",
    "documents",
    "run-worker.js",
  );
  if (fs.existsSync(workerDist)) {
    const workerProc = spawn(process.execPath, [workerDist, "--poll"], {
      cwd: path.join(ROOT, "apps", "api"),
      env: { ...apiRuntimeEnv, DATABASE_URL: WORKER_DB_URL },
    });
    pipeOutput(workerProc, "WORKER", colors.worker);
    processes.push(workerProc);
  }

  // 3b. ZIP dossier intake/extraction has its own queue and worker.
  const dossierWorkerDist = path.join(
    ROOT,
    "apps",
    "api",
    "dist",
    "documents",
    "run-dossier-worker.js",
  );
  if (fs.existsSync(dossierWorkerDist)) {
    const dossierWorkerProc = spawn(
      process.execPath,
      [dossierWorkerDist, "--poll"],
      {
        cwd: path.join(ROOT, "apps", "api"),
        env: apiRuntimeEnv,
      },
    );
    pipeOutput(dossierWorkerProc, "DOSSIER", colors.worker);
    processes.push(dossierWorkerProc);
  } else {
    console.log(
      `${colors.red}[DOSSIER] Dist not found at ${dossierWorkerDist}. Run 'pnpm api:build' first.${colors.reset}`,
    );
  }

  const intakeWorkerDist = path.join(
    ROOT,
    "apps/api/dist/financial/run-intake-worker.js",
  );
  if (fs.existsSync(intakeWorkerDist)) {
    const intakeProc = spawn(process.execPath, [intakeWorkerDist, "--poll"], {
      cwd: path.join(ROOT, "apps/api"),
      env: apiRuntimeEnv,
    });
    pipeOutput(intakeProc, "FINANCIAL", colors.worker);
    processes.push(intakeProc);
  }

  // 4. Frontend Web (Next.js)
  const [pnpmCmd, webArgs, webShell] = pnpmCommand([
    builtWeb ? "start" : "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ]);
  const webProc = spawn(pnpmCmd, webArgs, {
    cwd: ROOT,
    shell: webShell,
    windowsHide: true,
    env: {
      ...systemEnv,
      AIC_BACKEND_URL: "http://127.0.0.1:3001/api/v2",
      AIC_FRONTEND_ORIGIN: "http://127.0.0.1:3000",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  pipeOutput(webProc, "WEB", colors.web);
  processes.push(webProc);
  await waitReady("Web", "http://127.0.0.1:3000");
  console.log(
    "\nAIC is ready: http://127.0.0.1:3000 (Ctrl+C to stop this stack).\n",
  );
}
void start().catch((error) => {
  console.error(error.message);
  cleanup();
  process.exitCode = 1;
});
