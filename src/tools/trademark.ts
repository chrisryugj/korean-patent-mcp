import { z } from "zod"
import type { KiprisApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"
import { patentCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { checkHeader, parseTrademarkList, parseTotalCount } from "../lib/xml-parser.js"
import { formatTrademarkResult } from "../lib/format.js"

export const SearchTrademarkSchema = z.object({
  query: z.string().min(1).describe("상표명 키워드. 예: '카카오', '신라면'"),
  numOfRows: z.number().int().min(1).max(100).optional().default(10).describe("결과 수 (기본 10, 최대 100)"),
  pageNo: z.number().int().min(1).optional().default(1).describe("페이지 번호 (기본 1)"),
  apiKey: z.string().optional().describe("KIPRIS 인증키(요청별 override)"),
})
export type SearchTrademarkInput = z.infer<typeof SearchTrademarkSchema>

export async function searchTrademark(
  api: KiprisApiClient,
  input: SearchTrademarkInput
): Promise<ToolResponse> {
  try {
    const cacheKey = `tm:${input.query}:${input.numOfRows}:${input.pageNo}`
    const cached = patentCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

    const xml = await api.trademarkSearch(
      { searchString: input.query, numOfRows: input.numOfRows, pageNo: input.pageNo },
      input.apiKey
    )

    if (checkHeader(xml)) return noResultHint(input.query, "상표", input.pageNo)
    const total = parseTotalCount(xml)
    const hits = parseTrademarkList(xml)
    if (hits.length === 0) return noResultHint(input.query, "상표", input.pageNo)

    const text = truncateResponse(formatTrademarkResult(input.query, total, hits))
    patentCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "search_trademark")
  }
}
