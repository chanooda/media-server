# Media Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NestJS + Cloudflare R2 기반 미디어 서버 구축 — Presigned PUT URL 업로드, webp Cron 변환, CDN 서빙, API Key 인증 제공

**Architecture:** 클라이언트는 NestJS로부터 Presigned PUT URL을 발급받아 R2에 직접 업로드. 이미지는 `raw/`에 저장 후 매 1분 Cron이 webp 변환하여 `media/`로 이동. 뷰/다운로드는 Cloudflare CDN이 직접 서빙. StorageProvider 인터페이스로 R2 구현체를 추상화.

**Tech Stack:** NestJS 11, @nestjs/schedule, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, sharp, class-validator, class-transformer, uuid

---

## File Map

```
src/
├── app.module.ts                          [수정] ConfigModule, ScheduleModule, StorageModule, MediaModule, ImageModule 등록
├── main.ts                                [수정] ValidationPipe 전역 등록, global prefix 없음
├── config/
│   └── storage.config.ts                  [생성] registerAs('storage', ...) — R2 credentials, CDN domain, API Key
├── common/
│   └── guards/
│       └── api-key.guard.ts               [생성] x-api-key 헤더 검증 Guard
├── storage/
│   ├── storage.module.ts                  [생성] R2StorageProvider를 STORAGE_PROVIDER 토큰으로 제공
│   ├── storage-provider.interface.ts      [생성] StorageProvider 인터페이스 + 토큰 상수
│   └── providers/
│       └── r2-storage.provider.ts         [생성] S3Client 기반 R2 구현체
├── image/
│   ├── image.module.ts                    [생성] ImageService, ImageConversionService 등록
│   ├── image.service.ts                   [생성] sharp webp 변환 로직
│   └── image-conversion.service.ts        [생성] Cron: raw/ 스캔 → 변환 → media/ 이동
└── media/
    ├── media.module.ts                    [생성] MediaController, MediaService 등록
    ├── media.controller.ts                [생성] POST /media/upload, DELETE /media/:key
    ├── media.service.ts                   [생성] presigned URL 발급, 삭제 로직
    └── dto/
        └── upload.dto.ts                  [생성] filename, contentType 검증 DTO
```

**테스트 파일 (src/ 내 *.spec.ts):**
```
src/common/guards/api-key.guard.spec.ts
src/storage/providers/r2-storage.provider.spec.ts
src/image/image.service.spec.ts
src/image/image-conversion.service.spec.ts
src/media/media.service.spec.ts
src/media/media.controller.spec.ts
```

---

## Task 1: 의존성 설치

**Files:**
- Modify: `package.json` (pnpm으로 설치)

- [ ] **Step 1: 필수 패키지 설치**

```bash
cd /Users/chanoo/Desktop/server/media-server
pnpm add @nestjs/config @nestjs/schedule @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp class-validator class-transformer uuid
```

- [ ] **Step 2: 타입 패키지 설치**

```bash
pnpm add -D @types/sharp @types/uuid
```

- [ ] **Step 3: 설치 확인**

```bash
pnpm list @nestjs/config @nestjs/schedule @aws-sdk/client-s3 sharp uuid
```

Expected: 모든 패키지가 목록에 표시됨

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install media server dependencies"
```

---

## Task 2: 환경변수 설정 및 Config

**Files:**
- Create: `src/config/storage.config.ts`
- Create: `.env.example`
- Create: `.env` (로컬 개발용, .gitignore에 추가)

- [ ] **Step 1: `.env.example` 생성**

```
# Storage (R2)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=your_bucket_name

# CDN
CDN_DOMAIN=media.example.com

# Auth
API_KEY=your_api_key_here

# Cron
CRON_CONCURRENCY=3

# Server
PORT=3000
```

- [ ] **Step 2: `.gitignore` 확인 (없으면 생성)**

현재 `.gitignore`가 없으므로 생성:

```
# env
.env
.env.local

# build
dist/
node_modules/

# coverage
coverage/
```

- [ ] **Step 3: `src/config/storage.config.ts` 생성**

```typescript
import { registerAs } from '@nestjs/config';

export const storageConfig = registerAs('storage', () => ({
  r2AccountId: process.env.R2_ACCOUNT_ID ?? '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  r2BucketName: process.env.R2_BUCKET_NAME ?? '',
  cdnDomain: process.env.CDN_DOMAIN ?? '',
  apiKey: process.env.API_KEY ?? '',
  cronConcurrency: parseInt(process.env.CRON_CONCURRENCY ?? '3', 10),
}));

export type StorageConfig = ReturnType<typeof storageConfig>;
```

- [ ] **Step 4: Commit**

```bash
git add src/config/storage.config.ts .env.example .gitignore
git commit -m "chore: add environment config"
```

---

## Task 3: StorageProvider 인터페이스

**Files:**
- Create: `src/storage/storage-provider.interface.ts`

- [ ] **Step 1: 인터페이스 및 토큰 정의**

```typescript
// src/storage/storage-provider.interface.ts
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageProvider {
  generateUploadUrl(
    key: string,
    contentType: string,
    maxSize: number,
  ): Promise<string>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string }>;
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<{ key: string; contentType: string }[]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/storage-provider.interface.ts
git commit -m "feat: add StorageProvider interface"
```

---

## Task 4: ApiKey Guard

**Files:**
- Create: `src/common/guards/api-key.guard.ts`
- Create: `src/common/guards/api-key.guard.spec.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/common/guards/api-key.guard.spec.ts
import { ApiKeyGuard } from './api-key.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function makeContext(apiKey: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: apiKey ? { 'x-api-key': apiKey } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  const configService = {
    get: jest.fn().mockReturnValue('secret'),
  } as unknown as ConfigService;

  beforeEach(() => {
    guard = new ApiKeyGuard(configService);
  });

  it('유효한 API Key이면 true 반환', () => {
    expect(guard.canActivate(makeContext('secret'))).toBe(true);
  });

  it('API Key가 없으면 UnauthorizedException', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('API Key가 틀리면 UnauthorizedException', () => {
    expect(() => guard.canActivate(makeContext('wrong'))).toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
pnpm test -- --testPathPattern=api-key.guard
```

Expected: FAIL — "Cannot find module './api-key.guard'"

- [ ] **Step 3: Guard 구현**

```typescript
// src/common/guards/api-key.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const apiKey = request.headers['x-api-key'];
    const validKey = this.configService.get<string>('storage.apiKey');

    if (!apiKey || apiKey !== validKey) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm test -- --testPathPattern=api-key.guard
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/common/guards/
git commit -m "feat: add ApiKey guard"
```

---

## Task 5: R2StorageProvider

**Files:**
- Create: `src/storage/providers/r2-storage.provider.ts`
- Create: `src/storage/providers/r2-storage.provider.spec.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/storage/providers/r2-storage.provider.spec.ts
import { R2StorageProvider } from './r2-storage.provider';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

const mockSend = jest.fn();
(S3Client as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      'storage.r2AccountId': 'acc123',
      'storage.r2AccessKeyId': 'key',
      'storage.r2SecretAccessKey': 'secret',
      'storage.r2BucketName': 'my-bucket',
    };
    return map[key];
  }),
} as unknown as ConfigService;

describe('R2StorageProvider', () => {
  let provider: R2StorageProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new R2StorageProvider(mockConfigService);
  });

  describe('generateUploadUrl', () => {
    it('presigned URL을 반환한다', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://presigned-url');
      const url = await provider.generateUploadUrl('raw/file.jpg', 'image/jpeg', 5 * 1024 * 1024);
      expect(url).toBe('https://presigned-url');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(PutObjectCommand),
        { expiresIn: 600 },
      );
    });
  });

  describe('getObject', () => {
    it('Buffer와 contentType을 반환한다', async () => {
      const mockBody = Readable.from(Buffer.from('hello'));
      mockSend.mockResolvedValue({
        Body: mockBody,
        ContentType: 'image/jpeg',
      });
      const result = await provider.getObject('media/file.jpg');
      expect(result.contentType).toBe('image/jpeg');
      expect(result.body).toBeInstanceOf(Buffer);
    });
  });

  describe('deleteObject', () => {
    it('DeleteObjectCommand를 호출한다', async () => {
      mockSend.mockResolvedValue({});
      await provider.deleteObject('media/file.jpg');
      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });
  });

  describe('listObjects', () => {
    it('prefix에 해당하는 객체 목록을 반환한다', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'raw/file1.jpg' },
          { Key: 'raw/file2.png' },
        ],
      });
      const result = await provider.listObjects('raw/');
      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('raw/file1.jpg');
    });

    it('Contents가 없으면 빈 배열 반환', async () => {
      mockSend.mockResolvedValue({});
      const result = await provider.listObjects('raw/');
      expect(result).toEqual([]);
    });
  });

  describe('upload', () => {
    it('PutObjectCommand를 호출한다', async () => {
      mockSend.mockResolvedValue({});
      await provider.upload('media/file.webp', Buffer.from('data'), 'image/webp');
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
pnpm test -- --testPathPattern=r2-storage.provider
```

Expected: FAIL

- [ ] **Step 3: R2StorageProvider 구현**

```typescript
// src/storage/providers/r2-storage.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { StorageProvider } from '../storage-provider.interface';

@Injectable()
export class R2StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const accountId = configService.get<string>('storage.r2AccountId');
    this.bucket = configService.get<string>('storage.r2BucketName') ?? '';
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: configService.get<string>('storage.r2AccessKeyId') ?? '',
        secretAccessKey:
          configService.get<string>('storage.r2SecretAccessKey') ?? '',
      },
    });
  }

  async generateUploadUrl(
    key: string,
    contentType: string,
    maxSize: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: maxSize,
    });
    return getSignedUrl(this.client, command, { expiresIn: 600 });
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = await this.streamToBuffer(response.Body as Readable);
    return { body, contentType: response.ContentType ?? 'application/octet-stream' };
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async listObjects(
    prefix: string,
  ): Promise<{ key: string; contentType: string }[]> {
    const response = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );
    return (response.Contents ?? [])
      .filter((obj) => obj.Key != null)
      .map((obj) => ({ key: obj.Key!, contentType: '' }));
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm test -- --testPathPattern=r2-storage.provider
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/
git commit -m "feat: add R2StorageProvider"
```

---

## Task 6: StorageModule

**Files:**
- Create: `src/storage/storage.module.ts`

- [ ] **Step 1: StorageModule 생성**

```typescript
// src/storage/storage.module.ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/storage.module.ts
git commit -m "feat: add StorageModule"
```

---

## Task 7: ImageService (sharp 변환)

**Files:**
- Create: `src/image/image.service.ts`
- Create: `src/image/image.service.spec.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/image/image.service.spec.ts
import { ImageService } from './image.service';
import sharp from 'sharp';

jest.mock('sharp');

describe('ImageService', () => {
  let service: ImageService;

  beforeEach(() => {
    service = new ImageService();
  });

  it('Buffer를 webp로 변환한다', async () => {
    const mockToBuffer = jest.fn().mockResolvedValue(Buffer.from('webp-data'));
    const mockWebp = jest.fn().mockReturnValue({ toBuffer: mockToBuffer });
    (sharp as unknown as jest.Mock).mockReturnValue({ webp: mockWebp });

    const input = Buffer.from('raw-image');
    const result = await service.convertToWebp(input);

    expect(sharp).toHaveBeenCalledWith(input);
    expect(mockWebp).toHaveBeenCalledWith({ quality: 80 });
    expect(result).toBeInstanceOf(Buffer);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
pnpm test -- --testPathPattern=image.service.spec
```

Expected: FAIL

- [ ] **Step 3: ImageService 구현**

```typescript
// src/image/image.service.ts
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

@Injectable()
export class ImageService {
  async convertToWebp(input: Buffer): Promise<Buffer> {
    return sharp(input).webp({ quality: 80 }).toBuffer();
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm test -- --testPathPattern=image.service.spec
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/image/image.service.ts src/image/image.service.spec.ts
git commit -m "feat: add ImageService for webp conversion"
```

---

## Task 8: UploadDto

**Files:**
- Create: `src/media/dto/upload.dto.ts`

> 참고: `class-validator`를 사용하므로 `main.ts`에서 `ValidationPipe` 등록 필요 (Task 13에서 처리)

- [ ] **Step 1: 허용 MIME 타입 상수 및 DTO 정의**

```typescript
// src/media/dto/upload.dto.ts
import { IsIn, IsString, Matches } from 'class-validator';

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const ALLOWED_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_SIZE_BY_TYPE: Record<string, number> = {
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'image/gif': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'application/pdf': 20 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    20 * 1024 * 1024,
};

export class UploadDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9._\-\s()]+$/, {
    message: 'filename must be alphanumeric with . _ - ( ) allowed',
  })
  filename: string;

  @IsIn(ALLOWED_CONTENT_TYPES, {
    message: `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
  })
  contentType: AllowedContentType;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/media/dto/upload.dto.ts
git commit -m "feat: add UploadDto with allowed content types"
```

---

## Task 9: MediaService

**Files:**
- Create: `src/media/media.service.ts`
- Create: `src/media/media.service.spec.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/media/media.service.spec.ts
import { MediaService } from './media.service';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from '../storage/storage-provider.interface';

const mockStorage: jest.Mocked<StorageProvider> = {
  generateUploadUrl: jest.fn(),
  getObject: jest.fn(),
  upload: jest.fn(),
  deleteObject: jest.fn(),
  listObjects: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'storage.cdnDomain') return 'media.example.com';
    return undefined;
  }),
} as unknown as ConfigService;

describe('MediaService', () => {
  let service: MediaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MediaService(mockStorage, mockConfig);
  });

  describe('generateUploadUrl (이미지)', () => {
    it('raw/ 경로로 presigned URL 발급, publicUrl은 .webp', async () => {
      mockStorage.generateUploadUrl.mockResolvedValue('https://presigned');

      const result = await service.generateUploadUrl('photo.jpg', 'image/jpeg');

      expect(mockStorage.generateUploadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^raw\/.+-photo\.jpg$/),
        'image/jpeg',
        5 * 1024 * 1024,
      );
      expect(result.uploadUrl).toBe('https://presigned');
      expect(result.publicUrl).toMatch(/^https:\/\/media\.example\.com\/media\/.+\.webp$/);
      expect(result.expiresIn).toBe(600);
    });
  });

  describe('generateUploadUrl (문서)', () => {
    it('media/ 경로로 presigned URL 발급, publicUrl은 원본 확장자', async () => {
      mockStorage.generateUploadUrl.mockResolvedValue('https://presigned');

      const result = await service.generateUploadUrl(
        'report.pdf',
        'application/pdf',
      );

      expect(mockStorage.generateUploadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^media\/.+-report\.pdf$/),
        'application/pdf',
        20 * 1024 * 1024,
      );
      expect(result.publicUrl).toMatch(/\.pdf$/);
    });
  });

  describe('deleteFile', () => {
    it('media/:key 와 raw/:key 모두 삭제 시도', async () => {
      mockStorage.deleteObject.mockResolvedValue(undefined);

      await service.deleteFile('abc-file.webp');

      expect(mockStorage.deleteObject).toHaveBeenCalledWith('media/abc-file.webp');
      expect(mockStorage.deleteObject).toHaveBeenCalledWith('raw/abc-file.webp');
    });

    it('raw/ 삭제 실패해도 에러 미전파', async () => {
      mockStorage.deleteObject
        .mockResolvedValueOnce(undefined) // media/
        .mockRejectedValueOnce(new Error('not found')); // raw/

      await expect(service.deleteFile('abc-file.webp')).resolves.not.toThrow();
    });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
pnpm test -- --testPathPattern=media.service.spec
```

Expected: FAIL

- [ ] **Step 3: MediaService 구현**

```typescript
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
    const key = `${uuidv4()}${ext ? '-' + path.basename(filename) : filename}`;
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
```

> **Note:** `key` 생성 로직: `{uuid}-{filename}` 형태로 고유성 보장. 이미지 publicUrl의 확장자를 `.webp`로 교체.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm test -- --testPathPattern=media.service.spec
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/media/media.service.ts src/media/media.service.spec.ts
git commit -m "feat: add MediaService with upload URL generation and delete"
```

---

## Task 10: MediaController

**Files:**
- Create: `src/media/media.controller.ts`
- Create: `src/media/media.controller.spec.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/media/media.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ConfigService } from '@nestjs/config';

const mockMediaService = {
  generateUploadUrl: jest.fn(),
  deleteFile: jest.fn(),
};

describe('MediaController', () => {
  let controller: MediaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        { provide: MediaService, useValue: mockMediaService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('key') } },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MediaController>(MediaController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('POST /media/upload', () => {
    it('업로드 URL 발급 결과 반환', async () => {
      const mockResult = {
        key: 'abc-photo.jpg',
        uploadUrl: 'https://presigned',
        publicUrl: 'https://cdn/media/abc-photo.webp',
        expiresIn: 600,
      };
      mockMediaService.generateUploadUrl.mockResolvedValue(mockResult);

      const result = await controller.upload({
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

      expect(result).toEqual(mockResult);
      expect(mockMediaService.generateUploadUrl).toHaveBeenCalledWith(
        'photo.jpg',
        'image/jpeg',
      );
    });
  });

  describe('DELETE /media/:key', () => {
    it('파일 삭제 후 void 반환', async () => {
      mockMediaService.deleteFile.mockResolvedValue(undefined);
      await controller.delete('abc-photo.webp');
      expect(mockMediaService.deleteFile).toHaveBeenCalledWith('abc-photo.webp');
    });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
pnpm test -- --testPathPattern=media.controller.spec
```

Expected: FAIL

- [ ] **Step 3: MediaController 구현**

```typescript
// src/media/media.controller.ts
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { UploadDto } from './dto/upload.dto';
import { MediaService, UploadUrlResult } from './media.service';

@Controller('media')
@UseGuards(ApiKeyGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  upload(@Body() dto: UploadDto): Promise<UploadUrlResult> {
    return this.mediaService.generateUploadUrl(dto.filename, dto.contentType);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('key') key: string): Promise<void> {
    return this.mediaService.deleteFile(key);
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm test -- --testPathPattern=media.controller.spec
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/media/media.controller.ts src/media/media.controller.spec.ts
git commit -m "feat: add MediaController with upload and delete endpoints"
```

---

## Task 11: ImageConversionService (Cron)

**Files:**
- Create: `src/image/image-conversion.service.ts`
- Create: `src/image/image-conversion.service.spec.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/image/image-conversion.service.spec.ts
import { ImageConversionService } from './image-conversion.service';
import { ImageService } from './image.service';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from '../storage/storage-provider.interface';
import { Logger } from '@nestjs/common';

const mockStorage: jest.Mocked<StorageProvider> = {
  generateUploadUrl: jest.fn(),
  getObject: jest.fn(),
  upload: jest.fn(),
  deleteObject: jest.fn(),
  listObjects: jest.fn(),
};

const mockImageService = {
  convertToWebp: jest.fn(),
} as jest.Mocked<ImageService>;

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'storage.cronConcurrency') return 3;
    return undefined;
  }),
} as unknown as ConfigService;

describe('ImageConversionService', () => {
  let service: ImageConversionService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    service = new ImageConversionService(mockStorage, mockImageService, mockConfig);
  });

  it('raw/ 이미지를 webp 변환 후 media/에 저장하고 raw/ 삭제', async () => {
    mockStorage.listObjects.mockResolvedValue([
      { key: 'raw/abc-photo.jpg', contentType: 'image/jpeg' },
    ]);
    mockStorage.getObject.mockResolvedValue({
      body: Buffer.from('raw'),
      contentType: 'image/jpeg',
    });
    mockImageService.convertToWebp.mockResolvedValue(Buffer.from('webp'));
    mockStorage.upload.mockResolvedValue(undefined);
    mockStorage.deleteObject.mockResolvedValue(undefined);

    await service.processImages();

    expect(mockStorage.getObject).toHaveBeenCalledWith('raw/abc-photo.jpg');
    expect(mockImageService.convertToWebp).toHaveBeenCalled();
    expect(mockStorage.upload).toHaveBeenCalledWith(
      'media/abc-photo.webp',
      expect.any(Buffer),
      'image/webp',
    );
    expect(mockStorage.deleteObject).toHaveBeenCalledWith('raw/abc-photo.jpg');
  });

  it('변환 실패 시 raw/ 원본 유지 (deleteObject 미호출)', async () => {
    mockStorage.listObjects.mockResolvedValue([
      { key: 'raw/bad.jpg', contentType: 'image/jpeg' },
    ]);
    mockStorage.getObject.mockResolvedValue({
      body: Buffer.from('raw'),
      contentType: 'image/jpeg',
    });
    mockImageService.convertToWebp.mockRejectedValue(new Error('convert fail'));

    await service.processImages();

    expect(mockStorage.deleteObject).not.toHaveBeenCalled();
  });

  it('raw/가 비어있으면 아무것도 처리하지 않음', async () => {
    mockStorage.listObjects.mockResolvedValue([]);
    await service.processImages();
    expect(mockStorage.getObject).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
pnpm test -- --testPathPattern=image-conversion.service
```

Expected: FAIL

- [ ] **Step 3: ImageConversionService 구현**

```typescript
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

    // 이미 처리 중이 아닌 항목만 필터
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
      const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
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
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
pnpm test -- --testPathPattern=image-conversion.service
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/image/image-conversion.service.ts src/image/image-conversion.service.spec.ts
git commit -m "feat: add ImageConversionService with cron job"
```

---

## Task 12: Module 연결 및 AppModule 최종 구성

**Files:**
- Create: `src/image/image.module.ts`
- Create: `src/media/media.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: ImageModule 생성**

```typescript
// src/image/image.module.ts
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
```

- [ ] **Step 2: MediaModule 생성**

```typescript
// src/media/media.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageModule } from '../storage/storage.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [ConfigModule, StorageModule],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
```

- [ ] **Step 3: AppModule 수정**

```typescript
// src/app.module.ts
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
```

> 기존 `AppController`, `AppService`는 제거 (보일러플레이트 불필요)

- [ ] **Step 4: main.ts 수정 (ValidationPipe 등록)**

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 5: 기존 보일러플레이트 삭제**

```bash
rm src/app.controller.ts src/app.controller.spec.ts src/app.service.ts
```

- [ ] **Step 6: 전체 테스트 실행**

```bash
pnpm test
```

Expected: 모든 테스트 PASS (api-key.guard, r2-storage.provider, image.service, image-conversion.service, media.service, media.controller)

- [ ] **Step 7: 빌드 확인**

```bash
pnpm build
```

Expected: `dist/` 디렉토리 생성, 컴파일 에러 없음

- [ ] **Step 8: Commit**

```bash
git add src/app.module.ts src/main.ts src/image/image.module.ts src/media/media.module.ts
git rm src/app.controller.ts src/app.controller.spec.ts src/app.service.ts
git commit -m "feat: wire up modules and complete app bootstrap"
```

---

## Task 13: .env 설정 및 로컬 동작 확인

> 실제 R2 자격증명이 있어야 완전한 확인 가능. 없으면 서버 기동만 확인.

- [ ] **Step 1: .env 파일 생성 (실제 값으로)**

`.env.example`을 복사하여 `.env`를 만들고 실제 R2 자격증명 입력.

```bash
cp .env.example .env
# 에디터로 .env 편집 후 실제 값 입력
```

- [ ] **Step 2: 서버 기동 확인**

```bash
pnpm start:dev
```

Expected: `Nest application successfully started` 로그 출력, 포트 3000 리스닝

- [ ] **Step 3: API Key 없이 업로드 요청 → 401 확인**

```bash
curl -X POST http://localhost:3000/media/upload \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.jpg","contentType":"image/jpeg"}'
```

Expected: `{"statusCode":401,"message":"Unauthorized"}`

- [ ] **Step 4: 허용되지 않은 MIME 타입 → 400 확인**

```bash
curl -X POST http://localhost:3000/media/upload \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -d '{"filename":"test.exe","contentType":"application/x-msdownload"}'
```

Expected: `{"statusCode":400,"message":["contentType must be one of: ..."]}`

- [ ] **Step 5: 정상 업로드 URL 발급 확인 (실제 R2 필요)**

```bash
curl -X POST http://localhost:3000/media/upload \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -d '{"filename":"photo.jpg","contentType":"image/jpeg"}'
```

Expected:
```json
{
  "key": "<uuid>-photo.jpg",
  "uploadUrl": "https://<bucket>.r2.cloudflarestorage.com/raw/...",
  "publicUrl": "https://media.example.com/media/<uuid>-photo.webp",
  "expiresIn": 600
}
```

- [ ] **Step 6: Final Commit**

```bash
git add .
git commit -m "feat: complete media server implementation"
```

---

## 주의사항 요약

1. **이미지 publicUrl 접근 지연**: 업로드 후 Cron 처리 전까지 최대 1분간 404 발생 가능. 응답에 포함된 `status` 필드로 클라이언트 대응.
2. **Presigned PUT URL 크기 제한**: R2/S3 PUT presigned URL은 서버사이드에서 content-length를 강제하지 않음. 클라이언트 사이드 검증 병행 권장.
3. **Cron 중복 처리**: 메모리 내 `processingKeys` Set으로 같은 인스턴스 내 중복 방지. 멀티 인스턴스 환경에서는 분산 락(Redis 등) 필요.
4. **환경변수 누락 시**: ConfigService는 빈 문자열 반환. 서버 기동 시 필수값 검증 로직 추가 고려.
