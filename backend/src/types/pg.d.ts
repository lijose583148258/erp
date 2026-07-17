declare module 'pg' {
  export class Client {
    constructor(config?: { connectionString?: string });
    connect(): Promise<void>;
    end(): Promise<void>;
    query<T = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }>;
  }
}
