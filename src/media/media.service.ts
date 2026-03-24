// src/media/media.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import {
  STORAGE_PROVIDER,
  StorageProvider,
} from '../storage/storage-provider.interface';
import {
  ALLOWED_IMAGE_TYPES,
  AllowedContentType,
  MAX_SIZE_BY_TYPE,
} from './dto/upload.dto';

export interface UploadUrlResult {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  expiresIn: number;
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly configService: ConfigService,
  ) {}

  async generateUploadUrl(
    filename: string,
    contentType: AllowedContentType,
  ): Promise<UploadUrlResult> {
    const isImage = (ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType);
    const ext = path.extname(filename);
    const key = `${uuidv4()}-${path.basename(filename)}`;
    const storageKey = isImage ? `raw/${key}` : `media/${key}`;
    const maxSize = MAX_SIZE_BY_TYPE[contentType];

    const uploadUrl = await this.storage.generateUploadUrl(
      storageKey,
      contentType,
      maxSize,
    );

    const cdnDomain = this.configService.get<string>('storage.cdnDomain');
    const publicKey = isImage
      ? key.replace(new RegExp(`\\${ext}$`), '.webp')
      : key;
    const publicUrl = `https://${cdnDomain}/media/${publicKey}`;

    return { key, uploadUrl, publicUrl, expiresIn: 600 };
  }

  async deleteFile(key: string): Promise<void> {
    await this.storage.deleteObject(`media/${key}`);
    await this.storage.deleteObject(`raw/${key}`).catch(() => {
      // raw/ 원본이 없거나 삭제 실패해도 무시
    });
  }
}
