// src/media/media.service.spec.ts
import type { Mocked } from 'vitest';
import { MediaService } from './media.service';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from '../storage/storage-provider.interface';

const mockStorage: Mocked<StorageProvider> = {
  generateUploadUrl: vi.fn(),
  getObject: vi.fn(),
  upload: vi.fn(),
  deleteObject: vi.fn(),
  listObjects: vi.fn(),
};

const mockConfig = {
  get: vi.fn((key: string) => {
    if (key === 'storage.cdnDomain') return 'media.example.com';
    return undefined;
  }),
  getOrThrow: vi.fn((key: string) => {
    if (key === 'storage.cdnDomain') return 'media.example.com';
    throw new Error(`Config key not found: ${key}`);
  }),
} as unknown as ConfigService;

describe('MediaService', () => {
  let service: MediaService;

  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(result.publicUrl).toMatch(
        /^https:\/\/media\.example\.com\/media\/.+\.webp$/,
      );
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

      expect(mockStorage.deleteObject).toHaveBeenCalledWith(
        'media/abc-file.webp',
      );
      expect(mockStorage.deleteObject).toHaveBeenCalledWith(
        'raw/abc-file.webp',
      );
    });

    it('raw/ 삭제 실패해도 에러 미전파', async () => {
      mockStorage.deleteObject
        .mockResolvedValueOnce(undefined) // media/
        .mockRejectedValueOnce(new Error('not found')); // raw/

      await expect(service.deleteFile('abc-file.webp')).resolves.not.toThrow();
    });
  });
});
