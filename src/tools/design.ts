import { z } from "zod"
import type { KiprisApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"
import { patentCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { checkHeader, parseDesignList, parseTotalCount } from "../lib/xml-parser.js"
import { formatDesignResult } from "../lib/format.js"

export const SearchDesignSchema = z.object({
  query: z.string().min(1).describe("디자인 물품명 키워드. 예: '의자', '휴대폰 케이스'"),
  numOfRows: z.number().int().min(1).max(100).optional().default(10).describe("결과 수 (기본 10, 최대 100)"),
  pageNo: z.number().int().min(1).optional().default(1).describe("페이지 번호 (기본 1)"),
  apiKey: z.string().optional().describe("KIPRIS 인증키(요청별 override)"),
})
export type SearchDesignInput = z.infer<typeof SearchDesignSchema>

export async function searchDesign(
  api: KiprisApiClient,
  input: SearchDesignInput
): Promise<ToolResponse> {
  try {
    const cacheKey = `design:${input.query}:${input.numOfRows}:${input.pageNo}`
    const cached = patentCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

    const xml = await api.designSearch(
      { articleName: input.query, numOfRows: input.numOfRows, pageNo: input.pageNo },
      input.apiKey
    )

    if (checkHeader(xml)) return noResultHint(input.query, "디자인", input.pageNo)
    const total = parseTotalCount(xml)
    const hits = parseDesignList(xml)
    if (hits.length === 0) return noResultHint(input.query, "디자인", input.pageNo)

    const text = truncateResponse(formatDesignResult(input.query, total, hits))
    patentCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "search_design")
  }
}
