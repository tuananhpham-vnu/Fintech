import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { loadConfig, assertDocumentRuntime } from "../config/configuration";
import { DatabaseService } from "../database/database.service";
import { PrivateDocumentFiles } from "../document-storage/private-files";
import { DocumentAiTransport } from "../ai-adapters/document-ai-transport";
import { DossierRepository } from "./dossier.repository";
import { DossierWorker } from "./dossier-worker";

export async function main() {
  const config = loadConfig();
  assertDocumentRuntime(config);
  if (
    !config.documentRuntime ||
    process.argv.slice(2).some((arg) => !["--once", "--poll"].includes(arg))
  )
    throw Error("Local opt-in required");
  const db = new DatabaseService(config);
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  try {
    await db.onModuleInit();
    const worker = new DossierWorker(
      new DossierRepository(db, config),
      new PrivateDocumentFiles(config.storageDir),
      new DocumentAiTransport({
        baseURL: config.aiServiceUrl,
        internalKey: config.internalApiKey,
        expectedMode: config.documentAiMode,
        contractsDirectory: resolve(
          __dirname,
          "../../../../packages/contracts",
        ),
      }),
    );
    const id = randomUUID();
    do {
      const state = await worker.once(id);
      process.stdout.write("Dossier worker: " + state + "\n");
      if (!process.argv.includes("--poll")) break;
      if (!stopping)
        await new Promise((done) =>
          setTimeout(done, state === "idle" ? 1000 : 25),
        );
    } while (!stopping);
  } finally {
    await db.onModuleDestroy();
  }
}
if (require.main === module)
  main().catch(() => {
    process.stderr.write(
      "Dossier worker failed; check local configuration, migration and grants.\n",
    );
    process.exitCode = 1;
  });
