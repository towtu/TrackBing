// Pure period/quota/entitlement helpers. No Deno APIs — vitest-testable and
// reused by the ai-food edge function.

export function currentPeriod(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isProActive(proUntil: string | null, now: Date = new Date()): boolean {
  if (!proUntil) return false;
  const t = Date.parse(proUntil);
  return Number.isFinite(t) && t > now.getTime();
}

export type QuotaDecision = {
  allowed: boolean;
  reason?: "over_free_quota" | "over_pro_cap";
};

export function decideQuota(args: {
  isPro: boolean;
  monthCount: number;
  dayCount: number;
  freeMonthly: number;
  proDaily: number;
}): QuotaDecision {
  if (args.isPro) {
    return args.dayCount >= args.proDaily
      ? { allowed: false, reason: "over_pro_cap" }
      : { allowed: true };
  }
  return args.monthCount >= args.freeMonthly
    ? { allowed: false, reason: "over_free_quota" }
    : { allowed: true };
}
