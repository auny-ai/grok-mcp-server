// Single-use ledger for OAuth authorization codes.
//
// Why a Durable Object and not KV: Workers KV has no compare-and-set, so a
// `get` then `put` lets concurrent /oauth/token exchanges of one code all read
// "unused" and all mint a token.
//
// consumeCode is synchronous SQLite with no `await` between the check and the
// mark. A Durable Object runs one event at a time and synchronous code cannot
// be interleaved, so exactly one caller ever sees a first use.

import { DurableObject } from "cloudflare:workers";

export { LEDGER_NAME } from "./ledger-name.ts";

export const CREATE_SQL =
  "CREATE TABLE IF NOT EXISTS redeemed (code_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)";

// sha256b64url of the authorization code: a 32-byte digest is always 43
// base64url characters unpadded, whatever the input length.
const CODE_ID_LENGTH = 43;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

interface SqlLike {
  exec(query: string, ...params: unknown[]): { one(): Record<string, unknown> };
}

/**
 * True only for the first consume of `codeId` inside its lifetime.
 * Pure and synchronous: no `await` anywhere, which is what makes it atomic
 * inside a Durable Object.
 */
export function consumeCode(sql: SqlLike, codeId: unknown, expiresAt: unknown, now: unknown): boolean {
  if (typeof codeId !== "string" || codeId.length !== CODE_ID_LENGTH || !B64URL_RE.test(codeId)) {
    throw new Error("invalid code_id");
  }
  for (const value of [expiresAt, now]) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new Error("invalid time");
    }
  }

  // Refuse BEFORE purging. Without this, a replay arriving past its own expiry
  // would purge its own consumed marker and then be accepted as a first use.
  // A code eligible for purge is itself past `expiresAt`, so it must never in.
  if ((now as number) > (expiresAt as number)) return false;

  sql.exec("DELETE FROM redeemed WHERE expires_at < ?", now);
  sql.exec("INSERT OR IGNORE INTO redeemed (code_id, expires_at) VALUES (?, ?)", codeId, expiresAt);
  // changes(), not rowsWritten: the PK index may be counted separately from the
  // row insert, so rowsWritten can overcount a no-op INSERT OR IGNORE.
  return Number(sql.exec("SELECT changes() AS n").one().n) === 1;
}

export class CodeLedger extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    (this.ctx.storage as unknown as { sql: SqlLike }).sql.exec(CREATE_SQL);
  }

  consume(codeId: string, expiresAt: number): boolean {
    return consumeCode(
      (this.ctx.storage as unknown as { sql: SqlLike }).sql,
      codeId,
      expiresAt,
      Date.now()
    );
  }
}
