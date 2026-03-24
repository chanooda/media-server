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
