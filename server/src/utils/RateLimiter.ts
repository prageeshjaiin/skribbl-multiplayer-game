/**
 * Lightweight, self-cleaning in-memory rate limiter.
 * Protects expensive or abuse-prone socket actions from denial-of-service / flooding.
 * 
 * NOTE: This is an in-memory limiter scoped to the single Node.js process instance.
 * In a multi-instance / clustered deployment, a distributed store such as Redis
 * would be required for global cluster-wide rate limiting.
 */
export class RateLimiter {
  private limits: Map<string, { count: number; resetTime: number }>;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private lastCleanup: number;

  constructor(maxRequests: number, windowMs: number) {
    this.limits = new Map();
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.lastCleanup = Date.now();
  }

  /**
   * Consumes 1 request token for the given key.
   * Returns true if request is allowed, false if limit exceeded.
   */
  public check(key: string): boolean {
    const now = Date.now();
    this.cleanupIfDue(now);

    const entry = this.limits.get(key);
    if (!entry || now > entry.resetTime) {
      this.limits.set(key, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Reset the rate limit for a specific key (e.g. on clean disconnect).
   */
  public reset(key: string): void {
    this.limits.delete(key);
  }

  /**
   * Cleans up expired entries periodically to prevent unbounded memory growth.
   */
  private cleanupIfDue(now: number): void {
    if (now - this.lastCleanup > 30000) {
      this.lastCleanup = now;
      for (const [key, entry] of this.limits.entries()) {
        if (now > entry.resetTime) {
          this.limits.delete(key);
        }
      }
    }
  }

  public getActiveTrackedKeys(): number {
    return this.limits.size;
  }
}
