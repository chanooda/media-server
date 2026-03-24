// src/image/image-conversion.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import {
  STORAGE_PROVIDER,
  StorageProvider,
} from '../storage/storage-provider.interface';
import { ImageService } from './image.service';

@Injectable()
export class ImageConversionService {
  private readonly logger = new Logger(ImageConversionService.name);
  private readonly processingKeys = new Set<string>();
  private readonly concurrency: number;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly imageService: ImageService,
    private readonly configService: ConfigService,
  ) {
    this.concurrency = configService.get<number>('storage.cronConcurrency') ?? 3;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processImages(): Promise<void> {
    const objects = await this.storage.listObjects('raw/');
    if (objects.length === 0) return;

    this.logger.log(`Found ${objects.length} images in raw/ to process`);

    // 이미 처리 중이 아닌 항목만 필터, 최대 concurrency개 처리
    const pending = objects
      .filter((obj) => !this.processingKeys.has(obj.key))
      .slice(0, this.concurrency);

    await Promise.all(pending.map((obj) => this.convertOne(obj.key)));
  }

  private async convertOne(rawKey: string): Promise<void> {
    this.processingKeys.add(rawKey);
    try {
      const { body } = await this.storage.getObject(rawKey);

      const webpBuffer = await this.imageService.convertToWebp(body);

      // raw/abc-photo.jpg → media/abc-photo.webp
      const filename = path.basename(rawKey);
      const ext = path.extname(filename);
      const nameWithoutExt = ext ? filename.slice(0, -ext.length) : filename;
      const mediaKey = `media/${nameWithoutExt}.webp`;

      await this.storage.upload(mediaKey, webpBuffer, 'image/webp');
      await this.storage.deleteObject(rawKey);

      this.logger.log(`Converted: ${rawKey} → ${mediaKey}`);
    } catch (err) {
      this.logger.error(`Failed to convert ${rawKey}: ${(err as Error).message}`);
      // 원본 유지 — 다음 Cron에서 재시도
    } finally {
      this.processingKeys.delete(rawKey);
    }
  }
}
