import { ExecutionCandidate, ExecutionResult, KeeperRoute } from "../orders/types.js";

// In-memory store placeholder; replace with durable SQLite implementation when needed.
export class SqliteStore {
  private readonly attempts = new Map<string, { status: string; attempts: number }>();

  constructor(_path: string) {}

  isDuplicate(orderPubkey: string, route: KeeperRoute): boolean {
    const entry = this.attempts.get(`${orderPubkey}:${route}`);
    return entry?.status === "confirmed" || entry?.status === "simulated";
  }

  getAttemptCount(orderPubkey: string, route: KeeperRoute): number {
    return this.attempts.get(`${orderPubkey}:${route}`)?.attempts ?? 0;
  }

  recordCandidateFailure(
    candidate: ExecutionCandidate,
    _errorCode: string,
    attempts: number,
  ): void {
    this.attempts.set(`${candidate.orderPubkey.toBase58()}:${candidate.route}`, {
      status: "failed",
      attempts,
    });
  }

  recordExecutionResult(
    candidate: ExecutionCandidate,
    result: ExecutionResult,
    attempts: number,
  ): void {
    this.attempts.set(`${candidate.orderPubkey.toBase58()}:${candidate.route}`, {
      status: result.status,
      attempts,
    });
  }
}
