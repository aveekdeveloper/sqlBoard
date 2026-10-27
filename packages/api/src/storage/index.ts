import type { SqlboardConfig } from '../config.js';
import type { StorageBackend } from './local.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

export type { StorageBackend };

export function createStorage(config: SqlboardConfig): StorageBackend {
  if (config.s3Endpoint && config.s3AccessKey && config.s3SecretKey) {
    return new S3Storage({
      endpoint: config.s3Endpoint,
      accessKey: config.s3AccessKey,
      secretKey: config.s3SecretKey,
      bucket: config.s3Bucket || 'sqlboard',
      region: config.s3Region || 'us-east-1',
      forcePathStyle: config.s3ForcePathStyle ?? true,
    });
  }
  return new LocalStorage(config.uploadsDir);
}
