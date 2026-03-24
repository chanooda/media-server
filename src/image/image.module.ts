import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageModule } from '../storage/storage.module';
import { ImageService } from './image.service';
import { ImageConversionService } from './image-conversion.service';

@Module({
  imports: [ConfigModule, StorageModule],
  providers: [ImageService, ImageConversionService],
})
export class ImageModule {}
