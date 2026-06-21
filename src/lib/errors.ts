import type { ToolResponse } from "./types.js"
import { maskSensitiveUrl } from "./fetch-with-retry.js"

export const ErrorCodes = {
  NOT_FOUND: "PATENT_NOT_FOUND",
  INVALID_PARAM: "INVALID_PARAMETER",
  API_ERROR: "KIPRIS_API_ERROR",
  KEY_NOT_REGISTERED: "ACCESS_KEY_NOT_REGISTERED",
  DEADLINE_EXPIRED: "DEADLINE_EXPIRED",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "REQUEST_TIMEOUT",
} as const

/** KIPRIS resultCode → 의미 (공식 코드표) */
export const KIPRIS_RESULT_CODES: Record<string, string> = {
  "00": "정상",
  "10": "잘못된 요청 파라미터",
  "11": "필수 파라미터 누락",
  "20": "검색 결과 없음",
  "30": "등록되지 않은 인증키(해당 서비스 미신청)",
  "31": "인증키 사용기한 만료",
  "99": "서버 오류",
}

/** KIPRIS 응답 헤더의 resultCode 가 정상(00)이 아니면 던지는 에러 */
export class KiprisApiError extends Error {
  code: string
  resultCode: string
  constructor(resultCode: string, resultMsg?: string) {
    const desc = KIPRIS_RESULT_CODES[resultCode] || "알 수 없는 오류"
    super(`[${resultCode}] ${desc}${resultMsg ? ` (${resultMsg})` : ""}`)
    this.name = "KiprisApiError"
    this.resultCode = resultCode
    if (resultCode === "30") this.code = ErrorCodes.KEY_NOT_REGISTERED
    else if (resultCode === "31") this.code = ErrorCodes.DEADLINE_EXPIRED
    else if (resultCode === "10" || resultCode === "11")
      this.code = ErrorCodes.INVALID_PARAM
    else this.code = ErrorCodes.API_ERROR
  }
}

/** 검색 결과 0건 — LLM 환각 방지용 명시적 표지 */
export function noResultHint(query: string, label = "특허", pageNo = 1): ToolResponse {
  // 깊은 페이지의 0건은 "검색어 결과 없음"이 아니라 "그 페이지에 더 없음"일 수 있다.
  const lines =
    pageNo > 1
      ? [
          `[NOT_FOUND] ${label} '${query}' — ${pageNo}페이지에 결과 없음`,
          "",
          `⚠️ 이전 페이지에는 결과가 있을 수 있습니다(마지막 페이지 도달 가능성). 추측하거나 지어내지 마세요.`,
        ]
      : [
          `[NOT_FOUND] ${label} '${query}' 검색 결과 없음`,
          "",
          "⚠️ 실제 데이터를 찾지 못했습니다. 결과를 추측하거나 지어내지 마세요.",
        ]
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true }
}

/** 모든 도구 에러를 표준 형태로 변환 (+ 키 마스킹, Zod 에러 감지) */
export function formatToolError(error: unknown, context?: string): ToolResponse {
  let code: string
  let msg: string
  const suggestions: string[] = []

  if (error instanceof KiprisApiError) {
    code = error.code
    msg = error.message
    if (error.resultCode === "30") {
      suggestions.push(
        "이 키로는 해당 상세기능이 신청되지 않았습니다. plus.kipris.or.kr 마이페이지에서 해당 서비스 활용신청을 추가하세요."
      )
    } else if (error.resultCode === "31") {
      suggestions.push("인증키 사용기한이 만료됐습니다. KIPRIS Plus 에서 연장/재발급하세요.")
    } else if (error.resultCode === "10" || error.resultCode === "11") {
      suggestions.push("검색어 또는 파라미터를 확인하세요.")
    }
  } else if (error instanceof Error) {
    if (error.name === "ZodError" && Array.isArray((error as any).issues)) {
      code = ErrorCodes.INVALID_PARAM
      msg = (error as any).issues
        .map((i: any) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
      suggestions.push("파라미터 형식과 필수 값을 확인하세요.")
    } else {
      code = ErrorCodes.API_ERROR
      msg = error.message
    }
  } else {
    code = ErrorCodes.API_ERROR
    msg = String(error)
  }

  const lines = [`[${code}] ${maskSensitiveUrl(msg)}`]
  if (context) lines.push(`도구: ${context}`)
  if (suggestions.length > 0) {
    lines.push("제안:")
    suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  }
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true }
}
