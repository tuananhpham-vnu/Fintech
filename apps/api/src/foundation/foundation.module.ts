import { DynamicModule, Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { DatabaseService } from '../database/database.service'
import { AuthController, FoundationSessionGuard, SessionService } from '../auth'
import { CasesController } from '../controllers/cases.controller'
import { CounterpartiesController } from '../controllers/counterparties.controller'
import { FOUNDATION_CONFIG, FOUNDATION_DB, FoundationConfig } from './ports'
import { CoreRepository } from './core.repository'
import { CaseMutations } from './case-mutations'
import { FoundationHttpMiddleware } from './http'
import { FoundationOutputInterceptor } from './validation'
import type { AppConfig } from '../config/configuration'
import { DocumentsController } from '../documents/documents.controller'
import { PostgresDocumentRepository } from '../documents/postgres-document.repository'
import { DOCUMENT_REPOSITORY, DOCUMENT_FILES, DOCUMENT_INSPECTOR } from '../documents/ports'
import { PrivateDocumentFiles } from '../document-storage/private-files'
import { DocumentAiTransport } from '../ai-adapters/document-ai-transport'
import { resolve } from 'path'
import { MvpCaseService } from './mvp-case.service'
import { MvpWorkflowService } from './mvp-workflow.service'
import { MvpWorkflowsController } from '../controllers/mvp-workflows.controller'
import { DocumentDecisions } from '../documents/document-decisions.service'
import { MvpQuestionnaireService } from './mvp-questionnaire.service'
import { MvpQuestionnairesController } from '../controllers/mvp-questionnaires.controller'
import { MvpCapabilityService } from './mvp-capability.service'
import { MvpCapabilitiesController } from '../controllers/mvp-capabilities.controller'
import { MvpCounterpartyService } from './mvp-counterparty.service'
import { DocumentRetryService } from '../documents/document-retry.service'
import { FinancialRegistry } from '../financial/financial-registry.service'
import { MvpFinancialController } from '../controllers/mvp-financial.controller'
import { DocumentArchivesController } from '../documents/document-archives.controller'
import { DossiersController } from '../documents/dossiers.controller'
import { DossierRepository } from '../documents/dossier.repository'
import { AssistantController } from '../assistant/assistant.controller'
import { AssistantService } from '../assistant/assistant.service'

@Module({})
export class FoundationModule implements NestModule {
  static configure(config: AppConfig): DynamicModule {
    if (config.documentRuntime && config.isProduction)
      throw new Error('Document runtime is local only')
    return {
      module: FoundationModule,
      controllers: [
        AuthController,
        CasesController,
        CounterpartiesController,
        ...(config.documentRuntime
          ? [
              DocumentsController,
              DocumentArchivesController,
              DossiersController,
              MvpWorkflowsController,
              MvpQuestionnairesController,
              MvpCapabilitiesController,
              MvpFinancialController,
              AssistantController,
            ]
          : []),
      ],
      providers: [
        { provide: FOUNDATION_CONFIG, useValue: config },
        DatabaseService,
        { provide: FOUNDATION_DB, useExisting: DatabaseService },
        SessionService,
        CoreRepository,
        CaseMutations,
        ...(config.documentRuntime
          ? [
              PostgresDocumentRepository,
              DossierRepository,
              MvpCaseService,
              MvpWorkflowService,
              MvpQuestionnaireService,
              MvpCapabilityService,
              MvpCounterpartyService,
              DocumentDecisions,
              DocumentRetryService,
              FinancialRegistry,
              AssistantService,
              { provide: DOCUMENT_REPOSITORY, useExisting: PostgresDocumentRepository },
              {
                provide: DOCUMENT_FILES,
                useFactory: () => new PrivateDocumentFiles(config.storageDir),
              },
              {
                provide: DOCUMENT_INSPECTOR,
                useFactory: () =>
                  new DocumentAiTransport({
                    baseURL: config.aiServiceUrl,
                    internalKey: config.internalApiKey,
                    expectedMode: config.documentAiMode,
                    contractsDirectory: resolve(__dirname, '../../../../packages/contracts'),
                  }),
              },
            ]
          : []),
        FoundationHttpMiddleware,
        { provide: APP_GUARD, useClass: FoundationSessionGuard },
        { provide: APP_INTERCEPTOR, useClass: FoundationOutputInterceptor },
      ],
      exports: [DatabaseService, SessionService, CoreRepository, CaseMutations],
    }
  }
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FoundationHttpMiddleware).forRoutes('*')
  }
}
