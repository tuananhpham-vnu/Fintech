import { Inject, Injectable } from '@nestjs/common'
import { randomBytes, randomUUID } from 'node:crypto'
import { FoundationError } from '../foundation/errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from '../foundation/ports'
import type {
  AuthSession,
  FoundationConfig,
  FoundationDatabase,
  Principal,
  SessionOutput,
  SqlClient,
} from '../foundation/ports'
import { verifyPassword } from './password'
import {
  deriveCsrfToken,
  hashToken,
  isSessionToken,
  loginBucketHash,
  validateLogin,
} from './security'

interface UserRow {
  id: string
  organization_id: string
  username: string
  password_hash: string
  display_name: string
  role: string
  disabled_at: Date | string | null
}

export interface LoginResult {
  token: string
  session: SessionOutput
}
type LoginOutcome = { kind: 'ok'; result: LoginResult } | { kind: 'invalid' | 'limited' }

@Injectable()
export class SessionService {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
  ) {
    for (const value of [
      config.sessionTtlMs,
      config.sessionIdleMs,
      config.loginWindowMs,
      config.loginBlockMs,
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error('Invalid finite auth duration configuration')
    }
    if (
      !Number.isSafeInteger(config.loginMaxAttempts) ||
      config.loginMaxAttempts <= 0 ||
      config.loginMaxAttempts > 2147483647
    )
      throw new Error('Invalid finite login attempt configuration')
  }

  async login(username: string, password: string, peerAddress: string): Promise<LoginResult> {
    validateLogin({ username, password })
    const bucket = loginBucketHash(username, peerAddress)
    const outcome = await this.db.transaction<LoginOutcome>(async (client) => {
      // One account+peer bucket only. Transaction-scoped signed 64-bit advisory key.
      const lock = BigInt.asIntN(64, BigInt(`0x${bucket.slice(0, 16)}`)).toString()
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock])
      const throttle = await client.query(
        `SELECT attempts,
                window_started_at > clock_timestamp() - ($2::double precision * interval '1 millisecond') AS in_window,
                blocked_until > clock_timestamp() AS blocked
           FROM aic.login_attempts WHERE bucket_hash = $1 FOR UPDATE`,
        [bucket, this.config.loginWindowMs],
      )
      const prior = throttle.rows[0]
      if (
        prior &&
        (!Number.isSafeInteger(prior.attempts) ||
          prior.attempts < 0 ||
          prior.blocked === true ||
          (prior.in_window === true && prior.attempts >= this.config.loginMaxAttempts))
      )
        return { kind: 'limited' }

      const users = await client.query(
        `SELECT id, organization_id, username, password_hash, display_name, role, disabled_at
           FROM aic.lock_login_user($1)`,
        [username],
      )
      // Username must identify exactly one account; never choose an arbitrary tenant.
      const user: UserRow | undefined = users.rows.length === 1 ? users.rows[0] : undefined
      const valid = await verifyPassword(password, user?.password_hash ?? '')
      if (!valid || !user || user.disabled_at !== null || user.role !== 'specialist') {
        await this.recordFailure(client, bucket)
        // Return first: the failure counter MUST commit before an HTTP error is thrown.
        return { kind: 'invalid' }
      }

      const token = randomBytes(32).toString('base64url')
      const csrfToken = deriveCsrfToken(token)
      const inserted = await client.query(
        `INSERT INTO aic.sessions
          (id, organization_id, user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5,
                 clock_timestamp() + ($6::double precision * interval '1 millisecond'),
                 clock_timestamp(), clock_timestamp())
         RETURNING expires_at`,
        [
          randomUUID(),
          user.organization_id,
          user.id,
          hashToken(token),
          hashToken(csrfToken),
          this.config.sessionTtlMs,
        ],
      )
      // Success deliberately neither increments nor clears the current failure window.
      return {
        kind: 'ok',
        result: {
          token,
          session: {
            user: this.principal(user),
            csrf_token: csrfToken,
            expires_at: new Date(inserted.rows[0].expires_at).toISOString(),
          },
        },
      }
    })
    if (outcome.kind === 'ok') return outcome.result
    if (outcome.kind === 'limited') throw new FoundationError(429, 'RATE_LIMITED')
    throw new FoundationError(401, 'INVALID_CREDENTIALS')
  }

  /** Check and touch in one UPDATE: expired/revoked/idle sessions cannot be revived. */
  async resolve(token: string | undefined): Promise<AuthSession | null> {
    if (!isSessionToken(token)) return null
    const csrfToken = deriveCsrfToken(token)
    const result = await this.db.query(
      `UPDATE aic.sessions AS s SET last_seen_at = GREATEST(s.last_seen_at, clock_timestamp())
         FROM aic.users AS u
        WHERE s.token_hash = $1 AND s.csrf_hash = $2 AND s.revoked_at IS NULL
          AND s.expires_at > clock_timestamp()
          AND s.last_seen_at > clock_timestamp() - ($3::double precision * interval '1 millisecond')
          AND u.id = s.user_id AND u.organization_id = s.organization_id
          AND u.disabled_at IS NULL AND u.role = 'specialist'
        RETURNING s.id, s.expires_at, u.id AS user_id, u.organization_id, u.display_name, u.role`,
      [hashToken(token), hashToken(csrfToken), this.config.sessionIdleMs],
    )
    if (result.rows.length !== 1) return null
    const row = result.rows[0]
    return {
      id: row.id,
      user: {
        id: row.user_id,
        organization_id: row.organization_id,
        display_name: row.display_name,
        role: 'specialist',
      },
      csrfToken,
      expiresAt: new Date(row.expires_at).toISOString(),
    }
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!isSessionToken(token)) return
    await this.db.query(
      `UPDATE aic.sessions SET revoked_at = clock_timestamp()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(token)],
    )
  }

  private principal(user: UserRow): Principal {
    return {
      id: user.id,
      organization_id: user.organization_id,
      display_name: user.display_name,
      role: 'specialist',
    }
  }

  private async recordFailure(client: SqlClient, bucket: string): Promise<void> {
    await client.query(
      `INSERT INTO aic.login_attempts AS current
         (bucket_hash, window_started_at, attempts, blocked_until)
       VALUES ($1, clock_timestamp(), 1,
               CASE WHEN $2::integer = 1 THEN clock_timestamp() + ($4::double precision * interval '1 millisecond') ELSE NULL END)
       ON CONFLICT (bucket_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN current.window_started_at > EXCLUDED.window_started_at - ($3::double precision * interval '1 millisecond')
           THEN current.window_started_at ELSE EXCLUDED.window_started_at END,
         attempts = CASE
           WHEN current.window_started_at > EXCLUDED.window_started_at - ($3::double precision * interval '1 millisecond')
           THEN current.attempts + 1 ELSE 1 END,
         blocked_until = CASE
           WHEN (CASE WHEN current.window_started_at > EXCLUDED.window_started_at - ($3::double precision * interval '1 millisecond')
                      THEN current.attempts + 1 ELSE 1 END) >= $2::integer
           THEN EXCLUDED.window_started_at + ($4::double precision * interval '1 millisecond') ELSE NULL END`,
      [bucket, this.config.loginMaxAttempts, this.config.loginWindowMs, this.config.loginBlockMs],
    )
  }
}
