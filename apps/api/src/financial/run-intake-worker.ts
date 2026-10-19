import { randomUUID } from "node:crypto";
import { loadConfig, assertDocumentRuntime } from "../config/configuration";
import { DatabaseService } from "../database/database.service";
import { CoreRepository } from "../foundation/core.repository";
import { CaseMutations } from "../foundation/case-mutations";
import { FinancialIntakeService } from "./financial-intake.service";

async function main() {
  const config = loadConfig();
  assertDocumentRuntime(config);
  if (
    !config.documentRuntime ||
    process.argv.slice(2).some((a) => !["--once", "--poll"].includes(a))
  )
    throw Error("Local opt-in required");
  const db = new DatabaseService(config),
    core = new CoreRepository(db);
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  try {
    await db.onModuleInit();
    const worker = new FinancialIntakeService(
        db,
        config,
        core,
        new CaseMutations(db, config, core),
      ),
      id = randomUUID();
    do {
      const state = await worker.once(id);
      if (state !== "idle")
        process.stdout.write("Financial intake: " + state + "\n");
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
      "Financial intake worker failed; check configuration and migrations.\n",
    );
    process.exitCode = 1;
  });
