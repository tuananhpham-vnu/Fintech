import { DynamicModule, Module } from '@nestjs/common'
import { AppConfig } from './config/configuration'

@Module({})
export class AppModule {
  static configure(config: AppConfig): DynamicModule {
    const selected =
      config.runtimeMode === 'prototype'
        ? require('./prototype/prototype.module').PrototypeModule
        : require('./foundation/foundation.module').FoundationModule.configure(config)
    return { module: AppModule, imports: [selected] }
  }
}
