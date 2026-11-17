/**
 * 서버 KIPRIS_API_KEY 폴백 게이트 — 자체 키 없는 요청이 서버 키를 얼마나 쓸 수 있는지 판정한다.
 *
 * 차례로 본다:
 *   1. 클라이언트(접속 IP)별 분당 몫 — FALLBACK_PER_IP_RPM (0 = 끔)
 *   2. 클라이언트별 하루 몫 — FALLBACK_PER_IP_DAILY (0 = 끔)
 *   3. 전원 공유 분당 토큰버킷 — FALLBACK_RATE_LIMIT_RPM
 *   4. 전원 공유 롤링 24시간 총량 — FALLBACK_DAILY_CAP (서버 키 무료 한도 월 1,000회 보호, 운영 30)
 *
 * 1·2 가 없던 때는 IP 하나가 하루 공용 총량(30)을 혼자 다 쓸 수 있었다(2026-11-17 law 에서 같은 구조로
 * IP 하나가 공용 몫을 다 쓴 일을 보고 같이 고침). 1·2 가 거부하면 공용 몫을 건드리지 않고,
 * 3·4 가 거부하면 1·2 에서 뺀 몫을 돌려준다.
 */

import { createDailyCap, createKeyedDailyCap, createKeyedTokenBuckets, createTokenBucket } from "./rate-limit.js"

export interface FallbackGateOptions {
  rpm: number
  burst: number
  dailyCap: number
  perClientRpm: number
  perClientDaily: number
}

export type FallbackScope = "client-minute" | "client-daily" | "minute" | "daily"

export type FallbackVerdict =
  | { ok: true }
  | { ok: false; scope: FallbackScope; retryAfterSec: number }

export interface FallbackGate {
  /** n = 이 요청이 소모하는 tools/call 개수 */
  take(client: string, n: number, now?: number): FallbackVerdict
  sweep(now?: number): void
}

export function createFallbackGate(opts: FallbackGateOptions): FallbackGate {
  const clientMinute = createKeyedTokenBuckets(opts.perClientRpm)
  const clientDay = createKeyedDailyCap(opts.perClientDaily)
  const minute = createTokenBucket(opts.rpm, opts.burst)
  const day = createDailyCap(opts.dailyCap)

  return {
    take(client, n, now = Date.now()) {
      const cm = clientMinute.take(client, n, now)
      if (!cm.ok) return { ok: false, scope: "client-minute", retryAfterSec: cm.retryAfterSec }
      const cd = clientDay.take(client, n, now)
      if (!cd.ok) {
        clientMinute.refund(client, n)
        return { ok: false, scope: "client-daily", retryAfterSec: cd.retryAfterSec }
      }
      const refund = () => { clientMinute.refund(client, n); clientDay.refund(client, n) }
      const m = minute.take(n, now)
      if (!m.ok) {
        refund()
        return { ok: false, scope: "minute", retryAfterSec: m.retryAfterSec }
      }
      // 분당 게이트를 통과한 요청만 일일 총량을 소모한다 (거부분 낭비 방지)
      const d = day.take(n, now)
      if (!d.ok) {
        refund()
        return { ok: false, scope: "daily", retryAfterSec: d.retryAfterSec }
      }
      return { ok: true }
    },
    sweep(now) {
      clientMinute.sweep(now)
      clientDay.sweep(now)
    },
  }
}

const OWN_KEY = "provide your own key via 'x-api-key' header (무료 발급: https://plus.kipris.or.kr)"

/** 429 본문. 분당·일일 공용 문구는 종전과 같다 */
export function fallbackDeniedMessage(v: Extract<FallbackVerdict, { ok: false }>, opts: FallbackGateOptions): string {
  switch (v.scope) {
    case "client-minute":
      return `This client exceeded its share of the shared API key (${opts.perClientRpm} tool calls/min per client). Slow down and retry in ${v.retryAfterSec}s, or ${OWN_KEY}.`
    case "client-daily":
      return `This client used its daily share of the shared API key (${opts.perClientDaily} tool calls/day per client, 서버 키 무료 한도 보호). Provide your own key via 'x-api-key' header (무료 발급: https://plus.kipris.or.kr).`
    case "daily":
      return "Shared API daily cap reached (서버 키 무료 한도 보호). Provide your own key via 'x-api-key' header (무료 발급: https://plus.kipris.or.kr)."
    default:
      return `Shared API quota exceeded — retry in ${v.retryAfterSec}s, or ${OWN_KEY}.`
  }
}

/** 정수 env. 비었거나 숫자가 아니면 기본값(NaN 이 버킷 비교를 무력화하지 않게) */
export function intEnv(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? NaN : parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}
