/** Legacy feasibility harness: never selected by the production/default entry. */
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthController } from './auth.controller'
import { CasesController } from './cases.controller'
import { CounterpartiesController } from './counterparties.controller'
import { DocumentsController } from '../controllers/documents.controller'
import { JobsController } from '../controllers/jobs.controller'
import { EvidenceController } from '../controllers/evidence.controller'
import { InMemoryDbService } from '../state/in-memory-db.service'
import { StorageService } from '../storage/storage.service'
import { AiClientService } from '../ai-client/ai-client.service'
import { SessionAuthGuard } from '../guards/session-auth.guard'
import { RequestLoggingMiddleware } from '../middleware/request-logging.middleware'

@Module({
  controllers: [
    AuthController,
    CasesController,
    CounterpartiesController,
    DocumentsController,
    JobsController,
    EvidenceController,
  ],
  providers: [
    InMemoryDbService,
    StorageService,
    AiClientService,
    RequestLoggingMiddleware,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
})
export class PrototypeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*')
  }
}
