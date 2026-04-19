// src/storage/providers/r2-storage.provider.spec.ts
import { R2StorageProvider } from './r2-storage.provider';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockSend;
  },
  GetObjectCommand: class GetObjectCommand {},
  PutObjectCommand: class PutObjectCommand {},
  DeleteObjectCommand: class DeleteObjectCommand {},
  ListObjectsV2Command: class ListObjectsV2Command {},
}));

vi.mock('@aws-sdk/s3-request-presigner');

const mockConfigService = {
  get: vi.fn((key: string) => {
    const map: Record<string, string> = {
      'storage.r2AccountId': 'acc123',
      'storage.r2AccessKeyId': 'key',
      'storage.r2SecretAccessKey': 'secret',
      'storage.r2BucketName': 'my-bucket',
    };
    return map[key];
  }),
  getOrThrow: vi.fn((key: string) => {
    const map: Record<string, string> = {
      'storage.r2AccountId': 'acc123',
      'storage.r2AccessKeyId': 'key',
      'storage.r2SecretAccessKey': 'secret',
      'storage.r2BucketName': 'my-bucket',
    };
    const value = map[key];
    if (!value) throw new Error(`Config key not found: ${key}`);
    return value;
  }),
} as unknown as ConfigService;

describe('R2StorageProvider', () => {
  let provider: R2StorageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new R2StorageProvider(mockConfigService);
  });

  describe('generateUploadUrl', () => {
    it('presigned URL을 반환한다', async () => {
      vi.mocked(getSignedUrl).mockResolvedValue('https://presigned-url');
      const url = await provider.generateUploadUrl(
        'raw/file.jpg',
        'image/jpeg',
        5 * 1024 * 1024,
      );
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
        Contents: [{ Key: 'raw/file1.jpg' }, { Key: 'raw/file2.png' }],
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
      await provider.upload(
        'media/file.webp',
        Buffer.from('data'),
        'image/webp',
      );
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });
  });
});
