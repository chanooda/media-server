// src/image/image-conversion.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { STORAGE_PROVIDER } from '../storage/storage-provider.interface';
import type { StorageProvider } from '../storage/storage-provider.interface';
import { ImageService } from './image.service';

@Injectable()
export class ImageConversionService {
  private readonly logger = new Logger(ImageConversionService.name);
  // NOTE: processingKeys prevents re-entrancy within a single process instance only.
  // Horizontal scaling requires a distributed lock (e.g. Redis).
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
    let objects: { key: string; contentType: string }[];
    try {
      objects = await this.storage.listObjects('raw/');
    } catch (err) {
      this.logger.error(`Failed to list raw/ objects: ${this.toErrorMessage(err)}`);
      return;
    }

    if (objects.length === 0) return;

    this.logger.log(`Found ${objects.length} images in raw/ to process`);

    const pending = objects
      .filter((obj) => !this.processingKeys.has(obj.key))
      .slice(0, this.concurrency);

    // Mark all pending keys before starting async work to prevent re-entrancy
    for (const obj of pending) {
      this.processingKeys.add(obj.key);
    }

    await Promise.all(pending.map((obj) => this.convertOne(obj.key)));
  }

  private async convertOne(rawKey: string): Promise<void> {
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
      this.logger.error(
        `Failed to convert ${rawKey}: ${this.toErrorMessage(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      // 원본 유지 — 다음 Cron에서 재시도
    } finally {
      this.processingKeys.delete(rawKey);
    }
  }

  private toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
