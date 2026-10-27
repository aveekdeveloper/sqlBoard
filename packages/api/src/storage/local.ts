import fs from 'node:fs';
import path from 'node:path';

export interface StorageBackend {
  upload(key: string, data: Buffer, contentType?: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  url(key: string): string;
}

export class LocalStorage implements StorageBackend {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private filePath(key: string): string {
    return path.join(this.baseDir, key);
  }

  async upload(key: string, data: Buffer): Promise<void> {
    const fp = this.filePath(key);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, data);
  }

  async download(key: string): Promise<Buffer> {
    return fs.readFileSync(this.filePath(key));
  }

  async delete(key: string): Promise<void> {
    const fp = this.filePath(key);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.filePath(key));
  }

  url(key: string): string {
    return `file:${this.filePath(key)}`;
  }
}
