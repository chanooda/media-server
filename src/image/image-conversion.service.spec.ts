// src/image/image-conversion.service.spec.ts
import type { Mocked } from 'vitest';
import { ImageConversionService } from './image-conversion.service';
import { ImageService } from './image.service';
import { ConfigService } from '@nestjs/config';
import { StorageProvider } from '../storage/storage-provider.interface';
import { Logger } from '@nestjs/common';

const mockStorage: Mocked<StorageProvider> = {
  generateUploadUrl: vi.fn(),
  getObject: vi.fn(),
  upload: vi.fn(),
  deleteObject: vi.fn(),
  listObjects: vi.fn(),
};

const mockImageService = {
  convertToWebp: vi.fn(),
} as Mocked<ImageService>;

const mockConfig = {
  get: vi.fn((key: string) => {
    if (key === 'storage.cronConcurrency') return 3;
    return undefined;
  }),
} as unknown as ConfigService;

describe('ImageConversionService', () => {
  let service: ImageConversionService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    service = new ImageConversionService(
      mockStorage,
      mockImageService,
      mockConfig,
    );
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

  it('변환 실패 시 raw/ → failed/ 로 이동 (무한 재시도 방지)', async () => {
    mockStorage.listObjects.mockResolvedValue([
      { key: 'raw/bad.jpg', contentType: 'image/jpeg' },
    ]);
    mockStorage.getObject.mockResolvedValue({
      body: Buffer.from('raw'),
      contentType: 'image/jpeg',
    });
    mockImageService.convertToWebp.mockRejectedValue(new Error('convert fail'));
    mockStorage.upload.mockResolvedValue(undefined);
    mockStorage.deleteObject.mockResolvedValue(undefined);

    await service.processImages();

    expect(mockStorage.upload).toHaveBeenCalledWith(
      'failed/bad.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(mockStorage.deleteObject).toHaveBeenCalledWith('raw/bad.jpg');
  });

  it('raw/가 비어있으면 아무것도 처리하지 않음', async () => {
    mockStorage.listObjects.mockResolvedValue([]);
    await service.processImages();
    expect(mockStorage.getObject).not.toHaveBeenCalled();
  });

  it('listObjects 실패 시 에러 로그 후 조용히 종료', async () => {
    mockStorage.listObjects.mockRejectedValue(new Error('R2 unavailable'));
    await expect(service.processImages()).resolves.not.toThrow();
    expect(mockStorage.getObject).not.toHaveBeenCalled();
  });
});
