// Test helper: makes a plain Postgres client look like neon's `sql`, which is
// what PostgresAccounts is written against: a tagged template that runs when
// awaited, plus `sql.transaction([...])` for several statements in one transaction.

import type { PGlite } from "@electric-sql/pglite";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type pgDriver from "pg";

type Rows = Record<string, unknown>[];

interface Query {
  text: string;
  values: unknown[];
}

function neonLike(run: (query: Query) => Promise<Rows>, transaction: (queries: Query[]) => Promise<Rows[]>) {
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
    const query: Query = { text, values };
    // Like neon's: nothing is sent until the query is awaited or put in a transaction.
    return {
      ...query,
      then: (resolve: (rows: Rows) => unknown, reject: (reason: unknown) => unknown) => run(query).then(resolve, reject),
    };
  };
  return Object.assign(tagged, { transaction }) as unknown as NeonQueryFunction<false, false>;
}

/** PGlite: an in-process Postgres. It runs one statement at a time. */
export function sqlForPglite(db: PGlite) {
  return neonLike(
    async (query) => (await db.query<Record<string, unknown>>(query.text, query.values)).rows,
    (queries) =>
      db.transaction(async (tx) => {
        const results: Rows[] = [];
        for (const query of queries) results.push((await tx.query<Record<string, unknown>>(query.text, query.values)).rows);
        return results;
      }),
  );
}

/** A real PostgreSQL server through a connection pool, so requests truly run side by side. */
export function sqlForPool(pool: pgDriver.Pool) {
  return neonLike(
    async (query) => (await pool.query(query.text, query.values)).rows,
    async (queries) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const results: Rows[] = [];
        for (const query of queries) results.push((await client.query(query.text, query.values)).rows);
        await client.query("commit");
        return results;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
