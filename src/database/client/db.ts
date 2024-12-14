import type { PgliteDatabase } from 'drizzle-orm/pglite';

import * as schema from '../schemas';

type DrizzleInstance = PgliteDatabase<typeof schema>;

// 定义加载状态类型
export enum DatabaseLoadingState {
  CompilingWasm = 'compiling_wasm',
  Error = 'error',
  Idle = 'idle',
  Initializing = 'initializing',
  LoadingDependencies = 'loading_dependencies',
  LoadingWasm = 'loading_wasm',
  Ready = 'ready',
}

// 定义状态回调接口
export interface DatabaseStateCallback {
  onError?: (error: Error) => void;
  onProgress?: (progress: number, phase: string) => void;
  onStateChange?: (state: DatabaseLoadingState, detail?: any) => void;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private dbInstance: DrizzleInstance | null = null;
  private initPromise: Promise<DrizzleInstance> | null = null;
  private currentState: DatabaseLoadingState = DatabaseLoadingState.Idle;
  private stateCallbacks: DatabaseStateCallback[] = [];

  // CDN 配置
  private static WASM_CDN_URL = 'https://unpkg.com/@electric-sql/pglite@0.2.15/dist/postgres.wasm';

  private constructor() {}

  static getInstance() {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  // 注册状态回调
  registerStateCallback(callback: DatabaseStateCallback) {
    this.stateCallbacks.push(callback);
    // 立即触发当前状态
    callback.onStateChange?.(this.currentState);
  }

  // 移除状态回调
  unregisterStateCallback(callback: DatabaseStateCallback) {
    const index = this.stateCallbacks.indexOf(callback);
    if (index > -1) {
      this.stateCallbacks.splice(index, 1);
    }
  }

  // 更新状态
  private setState(state: DatabaseLoadingState, detail?: any) {
    this.currentState = state;
    this.stateCallbacks.forEach((callback) => {
      callback.onStateChange?.(state, detail);
    });
  }

  // 更新进度
  private updateProgress(progress: number, phase: string) {
    this.stateCallbacks.forEach((callback) => {
      callback.onProgress?.(progress, phase);
    });
  }

  // 处理错误
  private handleError(error: Error) {
    this.setState(DatabaseLoadingState.Error, error);
    this.stateCallbacks.forEach((callback) => {
      callback.onError?.(error);
    });
  }

  // 加载并编译 WASM 模块
  private async loadWasmModule(): Promise<WebAssembly.Module> {
    try {
      this.setState(DatabaseLoadingState.LoadingWasm);

      // 创建用于跟踪下载进度的 Response
      const response = await fetch(DatabaseManager.WASM_CDN_URL);
      const contentLength = Number(response.headers.get('Content-Length')) || 0;
      const reader = response.body?.getReader();

      if (!reader) throw new Error('Failed to start WASM download');

      // 创建一个新的 ReadableStream 来跟踪下载进度
      const stream = new ReadableStream({
        async start(controller) {
          let receivedLength = 0;

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              controller.close();
              break;
            }

            receivedLength += value.length;
            const progress = (receivedLength / contentLength) * 100;

            // 更新下载进度
            DatabaseManager.instance.updateProgress(progress, 'wasm');
            controller.enqueue(value);
          }
        },
      });

      // 编译 WASM 模块
      this.setState(DatabaseLoadingState.CompilingWasm);
      const wasmModule = await WebAssembly.compileStreaming(
        new Response(stream, {
          headers: response.headers,
        }),
      );

      return wasmModule;
    } catch (error) {
      this.handleError(error as Error);
      throw error;
    }
  }

  // 异步加载 PGlite 相关依赖
  private async loadDependencies() {
    try {
      this.setState(DatabaseLoadingState.LoadingDependencies);

      const imports = [
        import('@electric-sql/pglite').then((m) => ({ default: m.PGlite })),
        import('@electric-sql/pglite/vector'),
        import('drizzle-orm/pglite'),
        import('@electric-sql/pglite'),
      ];

      // 监控依赖加载进度
      const results = await Promise.all(
        imports.map(async (importPromise, index) => {
          const result = await importPromise;
          this.updateProgress(((index + 1) / imports.length) * 100, 'dependencies');
          return result;
        }),
      );

      // @ts-expect-error
      const [{ default: PGlite }, { vector }, { drizzle }, { IdbFs, MemoryFS }] = results;

      return { IdbFs, MemoryFS, PGlite, drizzle, vector };
    } catch (error) {
      this.handleError(error as Error);
      throw error;
    }
  }

  // 初始化数据库
  async initialize(): Promise<DrizzleInstance> {
    if (this.initPromise) return this.initPromise;

    // @ts-ignore
    this.initPromise = (async () => {
      try {
        if (this.dbInstance) return this.dbInstance;

        // 加载依赖
        const { vector, drizzle, IdbFs, MemoryFS, PGlite } = await this.loadDependencies();

        // 加载并编译 WASM 模块
        const wasmModule = await this.loadWasmModule();

        // 配置 PGlite 初始化
        this.setState(DatabaseLoadingState.Initializing);

        const db = new PGlite({
          extensions: { vector },
          fs: typeof window === 'undefined' ? new MemoryFS('lobechat') : new IdbFs('lobechat'),
          relaxedDurability: true,
          wasmModule,
        });

        this.dbInstance = drizzle({ client: db, schema });
        this.setState(DatabaseLoadingState.Ready);

        return this.dbInstance;
      } catch (error) {
        this.initPromise = null;
        this.handleError(error as Error);
        throw error;
      }
    })();

    // @ts-ignore
    return this.initPromise;
  }

  get db(): DrizzleInstance {
    if (!this.dbInstance) {
      throw new Error('Database not initialized. Please call initialize() first.');
    }
    return this.dbInstance;
  }

  createProxy(): DrizzleInstance {
    return new Proxy({} as DrizzleInstance, {
      get: (target, prop) => {
        return this.db[prop as keyof DrizzleInstance];
      },
    });
  }

  // 获取当前状态
  getCurrentState(): DatabaseLoadingState {
    return this.currentState;
  }
}

// 导出单例
const dbManager = DatabaseManager.getInstance();

// 导出数据库实例
export const clientDB = dbManager.createProxy();

// 导出初始化方法
export const initializeDB = (callback?: DatabaseStateCallback) => {
  if (callback) {
    dbManager.registerStateCallback(callback);
  }
  return dbManager.initialize();
};

// 导出状态监听方法
export const addDatabaseStateListener = (callback: DatabaseStateCallback) => {
  dbManager.registerStateCallback(callback);
  return () => dbManager.unregisterStateCallback(callback);
};
