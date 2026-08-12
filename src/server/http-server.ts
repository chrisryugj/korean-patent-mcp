import express from "express"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { requestContext } from "../lib/session-state.js"
import { createTokenBucket, createDailyCap } from "../lib/rate-limit.js"
import { maskSensitiveUrl } from "../lib/fetch-with-retry.js"
import { VERSION } from "../version.js"
import { TOOL_COUNTS } from "../tool-registry.js"

/** 에러 메시지/스택에서 API 키 포함 URL scrub (MCP 응답·서버 로그 양쪽) */
function scrubError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: maskSensitiveUrl(error.message),
      stack: error.stack ? maskSensitiveUrl(error.stack) : undefined,
    }
  }
  return { message: maskSensitiveUrl(String(error)) }
}

/** Stateless Streamable HTTP 서버 (Fly.io 등 클라우드 배포용) */
export async function startHTTPServer(createServer: () => Server, port: number) {
  const app = express()

  // trust proxy: 기본 '1'(첫 프록시만 신뢰). 'true'/'all'은 X-Forwarded-For
  // 스푸핑으로 rate limit 우회 위험 → 명시적 opt-in. Fly.io edge는 1단.
  const trustProxyRaw = process.env.TRUST_PROXY ?? "1"
  const trustProxy: number | boolean | string =
    trustProxyRaw === "true" || trustProxyRaw === "all"
      ? true
      : trustProxyRaw === "false"
      ? false
      : /^\d+$/.test(trustProxyRaw)
      ? parseInt(trustProxyRaw, 10)
      : trustProxyRaw
  app.set("trust proxy", trustProxy)
  app.use(express.json({ limit: process.env.MCP_BODY_LIMIT || "100kb" }))

  // Rate limiting (IP당 분당)
  const rpm = parseInt(process.env.RATE_LIMIT_RPM || "60", 10)
  // 단일 POST(JSON-RPC 배치)에 허용하는 tools/call 개수 — 배치로 한도를 배수 우회하는 것 차단
  const maxBatchCalls = parseInt(process.env.MCP_MAX_BATCH_CALLS || "20", 10)
  const buckets = new Map<string, { count: number; resetAt: number }>()
  if (rpm > 0) {
    app.use((req, res, next) => {
      if (req.path === "/health" || req.path === "/") return next()
      // 핸드셰이크(initialize/tools/list)·알림은 계수하지 않는다 — claude.ai 커넥터는
      // 소수 egress IP로 몰려 IP 버킷을 공유하므로, 여기서 429를 맞으면 도구 목록
      // 자체를 못 싣는다(law-mcp v4.6.6 동일 수정). 비용 소모 요청만 게이트한다.
      const msgs = Array.isArray(req.body) ? req.body : [req.body]
      const callCount = msgs.filter((m: { method?: string }) => m?.method === "tools/call").length
      if (callCount === 0) return next()

      const ip = req.ip || req.socket.remoteAddress || "unknown"
      const now = Date.now()
      let b = buckets.get(ip)
      if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + 60_000 }
        buckets.set(ip, b)
      }
      b.count += callCount
      if (b.count > rpm) {
        const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000))
        res.setHeader("Retry-After", String(retryAfterSec))
        return res.status(429).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: `Too many requests — retry in ${retryAfterSec}s.` },
          id: null,
        })
      }
      next()
    })
    setInterval(() => {
      const now = Date.now()
      for (const [ip, b] of buckets) if (now >= b.resetAt) buckets.delete(ip)
    }, 5 * 60 * 1000).unref()
  }

  // CORS — 미설정 시 와일드카드(경고). 프로덕션은 CORS_ORIGIN 명시 권장.
  const corsOrigin = process.env.CORS_ORIGIN || "*"
  if (corsOrigin === "*") {
    process.stderr.write(
      "⚠️  CORS_ORIGIN 미설정 — 모든 도메인 허용 중. 프로덕션에서는 CORS_ORIGIN 환경변수를 설정하세요.\n"
    )
  }
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", corsOrigin)
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, mcp-session-id, apikey, x-api-key, kipris-key"
    )
    res.header("X-Content-Type-Options", "nosniff")
    res.header("X-Frame-Options", "DENY")
    res.header("Referrer-Policy", "strict-origin-when-cross-origin")
    if (req.method === "OPTIONS") return res.sendStatus(200)
    next()
  })

  app.get("/", (_req, res) => {
    res.json({
      name: "Korean Patent MCP (KIPRIS)",
      version: VERSION,
      status: "running",
      tools: TOOL_COUNTS.total,
      transport: "streamable-http (stateless)",
      endpoints: { mcp: "/mcp", health: "/health" },
    })
  })
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  )

  // 서버 KIPRIS_API_KEY 폴백 사용량 전역 상한 — 키 없는 분산 요청이 서버 키의
  // 무료 한도(1,000회/월)를 소진시키는 것 방지(IP당 limit만으로는 우회 가능).
  // 0이면 폴백 비활성(자체 키 없는 요청 거부).
  //
  // 무료 한도가 월 1,000회라 실질 방어선은 분당이 아니라 '일일 총량'이다.
  // 분당 상한만으로는 하루 이론 최대가 월 한도를 수십 배 넘어 보호가 되지 않는다.
  // 분당 게이트는 버스트 흡수용으로만 두고, 총량은 FALLBACK_DAILY_CAP이 잡는다.
  const fallbackRpm = parseInt(process.env.FALLBACK_RATE_LIMIT_RPM || "10", 10)
  const fallbackBurst = parseInt(process.env.FALLBACK_RATE_LIMIT_BURST || String(fallbackRpm), 10)
  // 1,000회/월 ÷ 31일 ≈ 32 — 여유를 두고 30. 초과분은 BYOK로 유도한다.
  const fallbackDailyLimit = parseInt(process.env.FALLBACK_DAILY_CAP || "30", 10)
  const fallbackMinute = createTokenBucket(fallbackRpm, fallbackBurst)
  const fallbackDay = createDailyCap(fallbackDailyLimit)
  // n = 이 요청이 소모하는 tools/call 개수 (배치는 배열 길이만큼 서버 키를 쓴다)
  function fallbackAllowed(n: number): { ok: boolean; retryAfterSec: number; daily: boolean } {
    const minute = fallbackMinute.take(n)
    if (!minute.ok) return { ...minute, daily: false }
    // 분당 게이트를 통과한 요청만 일일 총량을 소모한다 (거부분 낭비 방지)
    const day = fallbackDay.take(n)
    return { ok: day.ok, retryAfterSec: day.retryAfterSec, daily: !day.ok }
  }

  app.post("/mcp", async (req, res) => {
    const apiKey =
      (req.headers["apikey"] as string) ||
      (req.headers["x-api-key"] as string) ||
      (req.headers["kipris-key"] as string) ||
      (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") ||
      (req.query.key as string)

    // 자체 키 없는 요청은 서버 KIPRIS_API_KEY 로 폴백 — 전역 상한 적용.
    // 핸드셰이크(initialize/tools/list)·알림은 KIPRIS 쿼터를 쓰지 않으므로 계수하지 않는다.
    // 계수하면 커넥터가 붙을 때마다 쿼터가 깎여 도구 목록조차 못 싣는다(law-mcp v4.6.2 동일 수정).
    const bodyMessages = Array.isArray(req.body) ? req.body : [req.body]
    const callCount = bodyMessages.filter((m) => m?.method === "tools/call").length
    if (callCount > maxBatchCalls) {
      return res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Too many tool calls in one request (max ${maxBatchCalls}).` },
        id: null,
      })
    }
    if (!apiKey && callCount > 0) {
      const verdict = fallbackAllowed(callCount)
      if (!verdict.ok) {
        res.setHeader("Retry-After", String(verdict.retryAfterSec))
        return res.status(429).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: verdict.daily
              ? "Shared API daily cap reached (서버 키 무료 한도 보호). Provide your own key via 'x-api-key' header (무료 발급: https://plus.kipris.or.kr)."
              : `Shared API quota exceeded — retry in ${verdict.retryAfterSec}s, or provide your own key via 'x-api-key' header (무료 발급: https://plus.kipris.or.kr).`,
          },
          id: null,
        })
      }
    }

    let server: Server | undefined
    let transport: StreamableHTTPServerTransport | undefined
    try {
      server = createServer()
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on("close", () => {
        try { transport?.close() } catch { /* ignore */ }
        server?.close().catch(() => {})
      })
      await server.connect(transport)
      await requestContext.run({ apiKey }, async () => {
        await transport!.handleRequest(req, res, req.body)
      })
    } catch (error) {
      const scrubbed = scrubError(error)
      process.stderr.write(`[POST /mcp] Error: ${scrubbed.message}\n`)
      try { transport?.close() } catch { /* ignore */ }
      server?.close().catch(() => {})
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        })
      }
    }
  })

  // stateless 모드 — GET/DELETE /mcp 불허
  const methodNotAllowed = (_req: express.Request, res: express.Response) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Server runs in stateless mode." },
      id: null,
    })
  app.get("/mcp", methodNotAllowed)
  app.delete("/mcp", methodNotAllowed)

  const expressServer = app.listen(port, "0.0.0.0", () => {
    process.stderr.write(`✅ Korean Patent MCP HTTP server on :${port} (/mcp, /health)\n`)
  })

  // 종료 처리 — in-flight 요청 완료 대기(최대 10초) 후 강제 종료
  function gracefulShutdown(signal: string) {
    process.stderr.write(`${signal} received, shutting down...\n`)
    const forceExit = setTimeout(() => process.exit(1), 10_000)
    forceExit.unref()
    expressServer.close(() => {
      clearTimeout(forceExit)
      process.exit(0)
    })
  }
  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
}
