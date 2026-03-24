import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { R2StorageProvider } from './providers/r2-storage.provider';
import { STORAGE_PROVIDER } from './storage-provider.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useClass: R2StorageProvider,
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
