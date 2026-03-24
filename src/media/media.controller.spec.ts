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
