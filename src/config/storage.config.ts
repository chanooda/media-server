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
