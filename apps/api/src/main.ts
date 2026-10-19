import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import {
  loadConfig,
  AppConfig,
  assertDocumentRuntime,
} from './config/configuration'
import { FoundationExceptionFilter } from './foundation/http'
import { startupFailure, StartupStage } from './config/startup-diagnostics'
const cookieParser = require('cookie-parser')

export async function createApplication(
  config: AppConfig = loadConfig(),
  quiet = false,
) {
  assertDocumentRuntime(config)
  // Recheck mode here as well: no injected config can turn a production process into a harness.
  if (
    config.runtimeMode === 'prototype' &&
    (process.env.NODE_ENV !== 'test' ||
      process.env.AIC_ENABLE_PROTOTYPE !== 'true')
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
  if (config.runtimeMode === 'foundation')
    app.useGlobalFilters(new FoundationExceptionFilter())
  app.enableShutdownHooks()
  return app
}

if (require.main === module) {
  let startupStage: StartupStage = 'CONFIG'
  void (async () => {
    const config = loadConfig()
    startupStage = 'APPLICATION'
    const app = await createApplication(config)
    startupStage = 'LISTEN'
    // Loopback by default. Hosted deployments (Render) set AIC_LISTEN_HOST=0.0.0.0 explicitly.
    const host = process.env.AIC_LISTEN_HOST || '127.0.0.1'
    if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Invalid AIC_LISTEN_HOST')
    await app.listen(config.port, host)
    process.stdout.write(
      `AIC ${config.runtimeMode} listening on ${host === '0.0.0.0' ? 'all interfaces' : 'loopback'}:${config.port}\n`,
    )
  })().catch((error: unknown) => {
    process.stderr.write(startupFailure(error, startupStage))
    process.exitCode = 1
  })
}
