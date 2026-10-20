/**
 * Hosted deployment entry: runs the document, dossier and financial-intake worker loops in ONE Node process
 * (saves ~50 MB per avoided Node runtime on a 512 MB instance). Each loop is unchanged and keeps its own
 * database pool and SIGINT/SIGTERM handling. Local development still starts the three scripts separately.
 * Usage: node dist/run-workers.js --poll
 */
import { main as documentWorker } from "./documents/run-worker";
import { main as dossierWorker } from "./documents/run-dossier-worker";
import { main as intakeWorker } from "./financial/run-intake-worker";

const workers: [string, () => Promise<void>][] = [
  ["Document worker", documentWorker],
  ["Dossier worker", dossierWorker],
  ["Financial intake worker", intakeWorker],
];

/**
 * Safe one-line cause for operators: error class, PostgreSQL/Node error code and message, with URLs and any
 * "user:password@" fragment removed. PostgreSQL messages name roles/tables, never passwords; connection strings are
 * never part of them, but are redacted anyway in case a library echoes one.
 */
export function describeStartupError(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown; message?: unknown } | undefined;
  const name = typeof e?.name === "string" ? e.name : "Error";
  const code = typeof e?.code === "string" ? ` ${e.code}` : "";
  const message = (typeof e?.message === "string" ? e.message : String(error))
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/[^\s:@/]+:[^\s@/]+@/g, "<credentials>@")
    .replace(/(password|passwd|pwd)\s*[=:]\s*\S+/gi, "$1=<redacted>")
    .replace(/\s+/g, " ")
    .slice(0, 300);
  return `${name}${code}: ${message}`;
}

void Promise.all(
  workers.map(([name, run]) =>
    run().catch((error: unknown) => {
      // A dead loop must not go unnoticed: exit so the container supervisor restarts the whole backend.
      process.stderr.write(`${name} failed: ${describeStartupError(error)}\n`);
      process.exit(1);
    }),
  ),
);
