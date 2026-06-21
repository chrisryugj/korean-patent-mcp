import { z } from "zod"
import type { KiprisApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"
import { patentCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { checkHeader, parsePatentList, parseTotalCount } from "../lib/xml-parser.js"
import { formatSearchResult } from "../lib/format.js"

/** 검색류 공통 파라미터 */
const commonFields = {
  patent: z.boolean().optional().default(true).describe("특허 포함 (기본 true)"),
  utility: z.boolean().optional().default(true).describe("실용신안 포함 (기본 true)"),
  numOfRows: z.number().int().min(1).max(100).optional().default(10).describe("결과 수 (기본 10, 최대 100)"),
  pageNo: z.number().int().min(1).optional().default(1).describe("페이지 번호 (기본 1)"),
  descSort: z.boolean().optional().default(true).describe("최신순 내림차순 (기본 true)"),
  sortSpec: z
    .enum(["AD", "OPD", "GD", "RD", "PD"])
    .optional()
    .default("AD")
    .describe("정렬기준: AD=출원일 OPD=공개일 GD=공고일 RD=등록일 PD=우선일"),
  apiKey: z.string().optional().describe("KIPRIS 인증키(요청별 override, 보통 불필요)"),
}

export const SearchPatentsSchema = z.object({
  query: z.string().min(1).describe("자유검색 키워드 (발명명칭·초록·청구항·출원인 통합검색). 예: '드론 배터리'"),
  withAbstract: z.boolean().optional().default(false).describe("초록 본문 포함 여부 (기본 false)"),
  ...commonFields,
})
export type SearchPatentsInput = z.infer<typeof SearchPatentsSchema>

export async function searchPatents(
  api: KiprisApiClient,
  input: SearchPatentsInput
): Promise<ToolResponse> {
  try {
    const cacheKey = `free:${input.query}:${input.patent}:${input.utility}:${input.numOfRows}:${input.pageNo}:${input.sortSpec}:${input.descSort}:${input.withAbstract}`
    const cached = patentCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

    const xml = await api.freeSearch(
      {
        word: input.query,
        patent: input.patent,
        utility: input.utility,
        numOfRows: input.numOfRows,
        pageNo: input.pageNo,
        descSort: input.descSort,
        sortSpec: input.sortSpec,
      },
      input.apiKey
    )

    const empty = checkHeader(xml)
    if (empty) return noResultHint(input.query, "특허", input.pageNo)

    const total = parseTotalCount(xml)
    const hits = parsePatentList(xml)
    if (hits.length === 0) return noResultHint(input.query, "특허", input.pageNo)

    const text = truncateResponse(
      formatSearchResult("🔍 자유검색", input.query, total, hits, input.withAbstract)
    )
    patentCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "search_patents")
  }
}
