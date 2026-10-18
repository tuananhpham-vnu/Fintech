import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { loadConfig, AppConfig, assertDocumentRuntime } from './config/configuration'
import { FoundationExceptionFilter } from './foundation/http'
const cookieParser = require('cookie-parser')

export async function createApplication(config: AppConfig = loadConfig(), quiet = false) {
  assertDocumentRuntime(config)
  // Recheck mode here as well: no injected config can turn a production process into a harness.
  if (
    config.runtimeMode === 'prototype' &&
    (process.env.NODE_ENV !== 'test' || process.env.AIC_ENABLE_PROTOTYPE !== 'true')
  )
    throw new Error('Prototype mode is test-only')
  const app = await NestFactory.create(AppModule.configure(config), {
    logger: quiet ? false : ['error', 'warn', 'log'],
    bodyParser: false,
    abortOnError: false,
  })
  const express = require('express')
  app.use(express.json({ limit: '1mb', strict: true }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())
  app.setGlobalPrefix('api/v2')
  if (config.runtimeMode === 'foundation') app.useGlobalFilters(new FoundationExceptionFilter())
  app.enableShutdownHooks()
  return app
}

if (require.main === module) {
  void (async () => {
    const config = loadConfig(),
      app = await createApplication(config)
    await app.listen(config.port, '127.0.0.1')
    process.stdout.write(`AIC ${config.runtimeMode} listening on loopback:${config.port}\n`)
  })().catch(() => {
    process.stderr.write(
      'API startup failed; check non-secret configuration, database connectivity and applied migrations.\n',
    )
    process.exitCode = 1
  })
}
