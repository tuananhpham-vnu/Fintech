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

void Promise.all(
  workers.map(([name, run]) =>
    run().catch(() => {
      // Fixed message only, like the individual entrypoints. A dead loop must not go unnoticed:
      // exit so the container supervisor restarts the whole backend.
      process.stderr.write(`${name} failed; check configuration and migrations.\n`);
      process.exit(1);
    }),
  ),
);
