/** Applying db/migrations/*.sql (see migrations.mjs). */

/** A neon `sql` function, or anything shaped like one. */
export interface MigrationSql {
  (strings: TemplateStringsArray, ...values: unknown[]): PromiseLike<Record<string, unknown>[]>;
  query(text: string): PromiseLike<Record<string, unknown>[]>;
  transaction(queries: PromiseLike<unknown>[]): Promise<unknown>;
}

export function deployMigrationPlan(
  env: Record<string, string | undefined>,
): { run: true } | { run: false; fail: boolean; reason: string };
export function recordedByAnotherRun(error: unknown): boolean;
export function migrate(sql: MigrationSql, dir: string, log?: (line: string) => void): Promise<string[]>;
