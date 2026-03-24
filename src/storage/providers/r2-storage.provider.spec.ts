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
