import { z } from "zod"
import type { KiprisApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"
import { patentCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { checkHeader, parsePatentList, parseTotalCount } from "../lib/xml-parser.js"
import { formatSearchResult } from "../lib/format.js"

export const SearchByApplicantSchema = z.object({
  applicant: z.string().min(1).describe("출원인명 (기업·개인). 예: '삼성전자', '현대자동차'"),
  patent: z.boolean().optional().default(true).describe("특허 포함 (기본 true)"),
  utility: z.boolean().optional().default(true).describe("실용신안 포함 (기본 true)"),
  numOfRows: z.number().int().min(1).max(100).optional().default(10).describe("결과 수 (기본 10, 최대 100)"),
  pageNo: z.number().int().min(1).optional().default(1).describe("페이지 번호 (기본 1)"),
  descSort: z.boolean().optional().default(true).describe("최신순 (기본 true)"),
  apiKey: z.string().optional().describe("KIPRIS 인증키(요청별 override)"),
})
export type SearchByApplicantInput = z.infer<typeof SearchByApplicantSchema>

export async function searchByApplicant(
  api: KiprisApiClient,
  input: SearchByApplicantInput
): Promise<ToolResponse> {
  try {
    const cacheKey = `applicant:${input.applicant}:${input.patent}:${input.utility}:${input.numOfRows}:${input.pageNo}:${input.descSort}`
    const cached = patentCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

    const xml = await api.applicantSearch(
      {
        applicant: input.applicant,
        patent: input.patent,
        utility: input.utility,
        numOfRows: input.numOfRows,
        pageNo: input.pageNo,
        descSort: input.descSort,
      },
      input.apiKey
    )

    if (checkHeader(xml)) return noResultHint(input.applicant, "출원인", input.pageNo)
    const total = parseTotalCount(xml)
    const hits = parsePatentList(xml)
    if (hits.length === 0) return noResultHint(input.applicant, "출원인", input.pageNo)

    const text = truncateResponse(
      formatSearchResult("🏢 출원인검색", input.applicant, total, hits)
    )
    patentCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "search_by_applicant")
  }
}
