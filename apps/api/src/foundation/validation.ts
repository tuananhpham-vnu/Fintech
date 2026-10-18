import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import * as fs from "fs";
import * as path from "path";
import { map } from "rxjs";
import { FoundationError } from "./errors";

const bundle = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../packages/contracts/aic-foundation/schemas.json",
    ),
    "utf8",
  ),
);
const demoBundle = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../packages/contracts/aic-demo-48h/schemas.json",
    ),
    "utf8",
  ),
);
const dossierBundle = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../packages/contracts/aic-dossier/schemas.json",
    ),
    "utf8",
  ),
);
const assessmentBundle = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../packages/contracts/aic-assessment/schemas.json",
    ),
    "utf8",
  ),
);
const definitions = {
  ...bundle.definitions,
  ...demoBundle.definitions,
  ...dossierBundle.definitions,
  ...assessmentBundle.definitions,
  ...JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../../packages/contracts/aic-financial-import/schemas.json'), 'utf8')).definitions,
};
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
});
addFormats(ajv);
const validators = new Map<string, ReturnType<Ajv["compile"]>>();
export function validateContract(name: string, value: unknown, output = false) {
  if (!validators.has(name))
    validators.set(
      name,
      ajv.compile({ definitions, $ref: `#/definitions/${name}` }),
    );
  if (!validators.get(name)(value))
    throw new FoundationError(
      output ? 500 : 422,
      output ? "INVALID_SERVER_RESPONSE" : "INVALID_INPUT",
    );
  return value;
}
@Injectable()
export class FoundationOutputInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const name = context.getClass().name,
      handler = context.getHandler().name;
    const schema =
      name === "AuthController"
        ? handler === "logout"
          ? null
          : "SessionOutput"
        : name === "CasesController"
          ? handler === "list"
            ? "WorkspacePage"
            : handler === "getHistory"
              ? "HistoryEventPage"
              : "Workspace"
          : name === "CounterpartiesController"
            ? handler === "list"
              ? "CounterpartyPage"
              : "Counterparty"
            : name === "DocumentsController"
              ? ({
                  upload: "DocumentAccepted",
                  job: "Job",
                  extraction: "ExtractionRead",
                  legacyExtraction: "LegacyExtractionRead",
                  evidence: "Evidence",
                  classify: "DocumentDecisionOutput",
                  correct: "DocumentDecisionOutput",
                  verifyField: "DocumentDecisionOutput",
                  retry: "DocumentRetryOutput",
                  summary: "ExtractionSummary",
                }[handler] ?? null)
              : name === "DocumentArchivesController"
                ? handler === "uploadArchive"
                  ? "ArchiveImportOutput"
                  : null
                : name === "DossiersController"
                  ? ({
                      upload: "DossierAccepted",
                      list: "DossierArchiveList",
                      get: "DossierArchive",
                      summary: "DossierMemberSummary",
                    }[handler] ?? null)
                  : name === "MvpWorkflowsController"
                    ? ({
                        run: "ReviewRun",
                        getRun: "ReviewRun",
                        decideIssue: "IssueDecisionOutput",
                        readiness: "Readiness",
                        draft: "DocumentRequest",
                        edit: "DocumentRequest",
                        approve: "DocumentRequest",
                        cancel: "DocumentRequest",
                        ack: "DocumentRequest",
                        waive: "Waiver",
                        revoke: "Waiver",
                      }[handler] ?? null)
                    : name === "AssessmentsController"
                      ? handler === "list"
                        ? "AssessmentPage"
                        : "Assessment"
                      : name === "MvpFinancialController"
                        ? ({
                            get: "FinancialRegistry",
                            create: "FinancialMutationOutput",
                            revise: "FinancialMutationOutput",
                            verify: "FinancialMutationOutput",
                          }[handler] ?? null)
                        : name === "MvpCapabilitiesController"
                          ? ({
                              create: "InvitationCreated",
                              revoke: "InvitationCreated",
                              close: "QuestionnaireState",
                              form: "RespondentForm",
                              submit: "RespondentReceipt",
                            }[handler] ?? null)
                          : name === "MvpQuestionnairesController"
                            ? ({
                                create: "Questionnaire",
                                get: "Questionnaire",
                                respond: "StaffResponse",
                                verify: "ResponseVerificationOutput",
                              }[handler] ?? null)
                            : null;
    return next
      .handle()
      .pipe(
        map((value) =>
          schema ? validateContract(schema, value, true) : value,
        ),
      );
  }
}
