// 서버 키 폴백 게이트 단위 테스트 (KIPRIS 를 부르지 않는다). 실행: npm run test:unit (build/ 를 먼저 만든다)
import test from "node:test"
import assert from "node:assert/strict"
import { createFallbackGate, fallbackDeniedMessage, intEnv } from "../build/lib/fallback-gate.js"
import { createKeyedDailyCap, createKeyedTokenBuckets } from "../build/lib/rate-limit.js"

const T0 = 1_700_000_000_000
const DAY = 86_400_000
const opts = { rpm: 30, burst: 30, dailyCap: 30, perClientRpm: 10, perClientDaily: 10 }

test("IP 하나는 하루 몫(10)까지만, 나머지 공용 몫은 다른 클라이언트가 쓴다", () => {
  const g = createFallbackGate(opts)
  // 분당 몫을 피해 1분 간격으로 보낸다
  for (let i = 0; i < 10; i++) assert.equal(g.take("heavy", 1, T0 + i * 60_000).ok, true)
  assert.deepEqual(g.take("heavy", 1, T0 + 11 * 60_000).scope, "client-daily")
  for (let i = 0; i < 20; i++) assert.equal(g.take(`u${i % 2}`, 1, T0 + 12 * 60_000 + i * 6_000).ok, true)
  assert.equal(g.take("u9", 1, T0 + 20 * 60_000).scope, "daily") // 공용 30 소진
})

test("분당 몫(10)을 넘으면 그 IP만 기다린다", () => {
  const g = createFallbackGate(opts)
  for (let i = 0; i < 10; i++) assert.equal(g.take("burst", 1, T0).ok, true)
  assert.equal(g.take("burst", 1, T0).scope, "client-minute")
  assert.equal(g.take("other", 1, T0).ok, true)
})

test("몫에서 거부된 요청은 공용 몫을 쓰지 않고, 공용이 거부하면 몫을 돌려준다", () => {
  const g = createFallbackGate({ ...opts, rpm: 1000, burst: 1000, dailyCap: 5, perClientDaily: 2 })
  for (let i = 0; i < 12; i++) g.take("heavy", 1, T0) // 2 통과, 10 은 하루 몫에서 거부
  for (let i = 0; i < 3; i++) assert.equal(g.take(`u${i}`, 1, T0).ok, true) // 공용 5 중 3 이 남아 있다
  assert.equal(g.take("u9", 1, T0).scope, "daily")
  const g2 = createFallbackGate({ ...opts, rpm: 2, burst: 2 })
  assert.equal(g2.take("a", 2, T0).ok, true)
  for (let i = 0; i < 5; i++) assert.equal(g2.take("b", 1, T0).scope, "minute")
  assert.equal(g2.take("b", 2, T0 + 60_000).ok, true) // b 의 몫은 그대로 남아 있었다
})

test("몫 0 이면 종전 동작(공용 한도만)", () => {
  const g = createFallbackGate({ ...opts, perClientRpm: 0, perClientDaily: 0 })
  for (let i = 0; i < 30; i++) assert.equal(g.take("heavy", 1, T0 + i * 3_000).ok, true)
  assert.equal(g.take("other", 1, T0 + 100_000).scope, "daily")
})

test("하루 몫은 24시간 뒤 다시 찬다, 키 수에 상한이 있다", () => {
  const c = createKeyedDailyCap(2, 3)
  c.take("a", 2, T0)
  assert.equal(c.take("a", 1, T0 + DAY - 1).ok, false)
  assert.equal(c.take("a", 1, T0 + DAY).ok, true)
  for (let i = 0; i < 10; i++) c.take(`k${i}`, 1, T0)
  assert.ok(c.size() <= 3)
  const b = createKeyedTokenBuckets(60, 60, 3)
  for (let i = 0; i < 10; i++) b.take(`k${i}`, 60, T0)
  assert.ok(b.size() <= 3)
})

test("429 문구: 공용 분당·일일은 종전과 같고, 몫 문구에 크기와 할 일을 싣는다", () => {
  assert.equal(
    fallbackDeniedMessage({ ok: false, scope: "minute", retryAfterSec: 4 }, opts),
    "Shared API quota exceeded — retry in 4s, or provide your own key via 'x-api-key' header (무료 발급: https://plus.kipris.or.kr).",
  )
  assert.equal(
    fallbackDeniedMessage({ ok: false, scope: "daily", retryAfterSec: 4 }, opts),
    "Shared API daily cap reached (서버 키 무료 한도 보호). Provide your own key via 'x-api-key' header (무료 발급: https://plus.kipris.or.kr).",
  )
  assert.match(fallbackDeniedMessage({ ok: false, scope: "client-daily", retryAfterSec: 9 }, opts), /10 tool calls\/day per client/)
  assert.match(fallbackDeniedMessage({ ok: false, scope: "client-minute", retryAfterSec: 9 }, opts), /10 tool calls\/min per client.*retry in 9s/)
})

test("intEnv: 숫자가 아니면 기본값", () => {
  assert.equal(intEnv(undefined, 5), 5)
  assert.equal(intEnv("12", 5), 12)
  assert.equal(intEnv("abc", 5), 5)
  assert.equal(intEnv("-3", 5), 5)
})
