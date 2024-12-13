import { IdbFs, MemoryFS, PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PgliteDatabase, drizzle } from 'drizzle-orm/pglite';

import * as schema from '../schemas';

let dbInstance: ReturnType<typeof drizzle>;

export function getClientDB() {
  // 如果已经初始化过，直接返回实例
  if (dbInstance) return dbInstance;

  // 服务端环境
  if (typeof window === 'undefined') {
    const db = new PGlite({
      extensions: { vector },
      fs: new MemoryFS('lobechat'),
    });
    return drizzle({ client: db, schema });
  }

  // 客户端环境
  const db = new PGlite({
    extensions: { vector },
    fs: new IdbFs('lobechat'),
    relaxedDurability: true,
  });

  dbInstance = drizzle({ client: db, schema });
  return dbInstance;
}

export const clientDB = getClientDB() as unknown as PgliteDatabase<typeof schema>;
