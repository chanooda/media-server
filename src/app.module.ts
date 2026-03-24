import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { storageConfig } from './config/storage.config';
import { StorageModule } from './storage/storage.module';
import { ImageModule } from './image/image.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [storageConfig],
    }),
    ScheduleModule.forRoot(),
    StorageModule,
    ImageModule,
    MediaModule,
  ],
})
export class AppModule {}
