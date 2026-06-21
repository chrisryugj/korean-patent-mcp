import { z } from "zod"
import type { KiprisApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"
import { patentCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { checkHeader, parsePatentList, parsePatentDetail } from "../lib/xml-parser.js"
import { formatDetail, formatHit } from "../lib/format.js"

/** 출원번호 정규화: 하이픈/공백 제거 (10-2016-0172841 → 1020160172841) */
function normalizeAppNo(s: string): string {
  return s.replace(/[\s-]/g, "")
}

export const GetPatentDetailSchema = z.object({
  applicationNumber: z
    .string()
    .min(1)
    .describe("출원번호 (하이픈 유무 무관). 예: '1020160172841' 또는 '10-2016-0172841'"),
  apiKey: z.string().optional().describe("KIPRIS 인증키(요청별 override)"),
})
export type GetPatentDetailInput = z.infer<typeof GetPatentDetailSchema>

/**
 * 출원번호로 상세 서지정보 조회.
 * 1) getBibliographyDetailInfoSearch(서지상세, ServiceKey) 우선 시도
 * 2) 권한 없음(30) 등 실패 시 applicationNumberSearchInfo(accessKey)로 폴백
 */
export async function getPatentDetail(
  api: KiprisApiClient,
  input: GetPatentDetailInput
): Promise<ToolResponse> {
  const appNo = normalizeAppNo(input.applicationNumber)
  try {
    const cacheKey = `detail:${appNo}`
    const cached = patentCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

    // 1) 서지상세 (ServiceKey 계열)
    try {
      const xml = await api.bibliographyDetail(appNo, input.apiKey)
      if (!checkHeader(xml)) {
        const detail = parsePatentDetail(xml)
        if (detail) {
          const text = truncateResponse(formatDetail(detail))
          patentCache.set(cacheKey, text)
          return { content: [{ type: "text", text }] }
        }
      }
    } catch {
      // 서지상세 권한/오류 → 폴백
    }

    // 2) 폴백: 출원번호 검색 (accessKey 계열, 초록·도면 포함)
    const xml2 = await api.applicationNumberSearch(appNo, input.apiKey)
    if (checkHeader(xml2)) {
      return {
        content: [
          { type: "text", text: `[NOT_FOUND] 출원번호 '${input.applicationNumber}' 정보 없음` },
        ],
        isError: true,
      }
    }
    const hits = parsePatentList(xml2)
    if (hits.length === 0) {
      return {
        content: [
          { type: "text", text: `[NOT_FOUND] 출원번호 '${input.applicationNumber}' 정보 없음` },
        ],
        isError: true,
      }
    }
    const text = truncateResponse(formatHit(1, hits[0], true))
    patentCache.set(cacheKey, text)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "get_patent_detail")
  }
}
