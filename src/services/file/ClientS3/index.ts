import { createStore, del, get, set } from 'idb-keyval';

const BROWSER_S3_DB_NAME = 'lobechat-local-s3';

class BrowserS3Storage {
  private store;

  constructor() {
    this.store = createStore(BROWSER_S3_DB_NAME, 'objects');
  }

  /**
   * 上传文件
   * @param key 文件 hash
   * @param file File 对象
   */
  async putObject(key: string, file: File): Promise<void> {
    try {
      const data = await file.arrayBuffer();
      await set(key, { data, name: file.name, type: file.type }, this.store);
    } catch (e) {
      throw new Error(`Failed to put file ${file.name}: ${(e as Error).message}`);
    }
  }

  /**
   * 获取文件
   * @param key 文件 hash
   * @returns File 对象
   */
  async getObject(key: string): Promise<File | undefined> {
    try {
      const res = await get<{ data: ArrayBuffer; name: string; type: string }>(key, this.store);
      return new File([res!.data], res!.name, { type: res?.type });
    } catch (e) {
      throw new Error(`Failed to get object (key=${key}): ${(e as Error).message}`);
    }
  }

  /**
   * 删除文件
   * @param key 文件 hash
   */
  async deleteObject(key: string): Promise<void> {
    try {
      await del(key, this.store);
    } catch (e) {
      throw new Error(`Failed to delete object (key=${key}): ${(e as Error).message}`);
    }
  }
}

export const clientS3Storage = new BrowserS3Storage();
