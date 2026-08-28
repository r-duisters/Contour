/**
 * `node:sqlite` shipped in Node 22 and the installed `@types/node` does not
 * describe it yet. Only what `test-db.ts` uses is declared — this is a test
 * driver, not the one the app ships on, and a fuller shim would suggest
 * otherwise.
 */
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): { changes: number | bigint };
    };
  }
}
