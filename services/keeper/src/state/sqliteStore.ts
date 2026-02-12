import { ExecutionCandidate, ExecutionResult, KeeperRoute } from "../orders/types.js";

// Scaffold store: in-memory only. Replace with SQLite persistence in implementation step.
export class SqliteStore {
  private readonly checkpoints = new Map<string, string>();
  private readonly attempts = new Map<string, { status: string; attempts: number }>();

  constructor(_path: string) {}

  getCheckpoint(key: string): string | null {
    return this.checkpoints.get(key) ?? null;
  }

  setCheckpoint(key: string, value: string): void {
    this.checkpoints.set(key, value);
  }

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

  close(): void {}
}
