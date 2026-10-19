/** PH1-PORTS-1: frozen shared interfaces. Lead is the only writer. */
export const FOUNDATION_DB = Symbol("FOUNDATION_DB");
export const FOUNDATION_CONFIG = Symbol("FOUNDATION_CONFIG");

export interface SqlResult {
  rows: any[];
  rowCount: number | null;
}
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<SqlResult>;
}
export interface FoundationDatabase extends SqlClient {
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
}
export interface FoundationConfig {
  fhiPolicy?: Readonly<import("../financial/fhi-policy").FhiPublicationPolicy>;
  internationalPolicy?: Readonly<import("../financial/accounting-profiles").InternationalPolicy>;
  databaseUrl: string;
  frontendOrigin: string;
  allowedOrigins: string[];
  cookieName: string;
  secureCookies: boolean;
  sessionTtlMs: number;
  sessionIdleMs: number;
  loginMaxAttempts: number;
  loginWindowMs: number;
  loginBlockMs: number;
  idempotencyTtlMs: number;
  isProduction: boolean;
  invitationTtlMs?: number;
  respondentRequestsPerMinute?: number;
}
export interface Principal {
  id: string;
  organization_id: string;
  display_name: string;
  role: "specialist";
}
export interface SessionOutput {
  user: Principal;
  csrf_token: string;
  expires_at: string;
}
export interface AuthSession {
  id: string;
  user: Principal;
  csrfToken: string;
  expiresAt: string;
}
export interface FoundationRequest {
  user: Principal;
  session: AuthSession;
  requestId: string;
}
