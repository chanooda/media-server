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
