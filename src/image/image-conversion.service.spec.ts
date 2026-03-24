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

  it('listObjects 실패 시 에러 로그 후 조용히 종료', async () => {
    mockStorage.listObjects.mockRejectedValue(new Error('R2 unavailable'));
    await expect(service.processImages()).resolves.not.toThrow();
    expect(mockStorage.getObject).not.toHaveBeenCalled();
  });
});
