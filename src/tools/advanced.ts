import { z } from "zod"
import type { KiprisApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"
import { patentCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { checkHeader, parseAdvancedList, parseTotalCount } from "../lib/xml-parser.js"
import { formatSearchResult } from "../lib/format.js"

export const SearchPatentsAdvancedSchema = z
  .object({
    inventionTitle: z.string().optional().describe("발명의 명칭에 포함된 키워드"),
    abstract: z.string().optional().describe("초록(요약)에 포함된 키워드"),
    claim: z.string().optional().describe("청구범위에 포함된 키워드"),
    ipc: z.string().optional().describe("IPC 분류코드. 예: 'B64C', 'G06N'"),
    applicant: z.string().optional().describe("출원인명"),
    inventor: z.string().optional().describe("발명자명"),
    patent: z.boolean().optional().default(true).describe("특허 포함 (기본 true)"),
    utility: z.boolean().optional().default(true).describe("실용신안 포함 (기본 true)"),
    numOfRows: z.number().int().min(1).max(100).optional().default(10).describe("결과 수 (기본 10, 최대 100)"),
    pageNo: z.number().int().min(1).optional().default(1).describe("페이지 번호 (기본 1)"),
    descSort: z.boolean().optional().default(true).describe("최신순 (기본 true)"),
    sortSpec: z.enum(["AD", "OPD", "GD", "RD", "PD"]).optional().default("AD").describe("정렬: AD=출원일 OPD=공개일 GD=공고일 RD=등록일 PD=우선일"),
    apiKey: z.string().optional().describe("KIPRIS 인증키(요청별 override)"),
  })
  .refine(
    (d) => d.inventionTitle || d.abstract || d.claim || d.ipc || d.applicant || d.inventor,
    { message: "최소 하나의 검색조건(inventionTitle/abstract/claim/ipc/applicant/inventor)이 필요합니다" }
  )
export type SearchPatentsAdvancedInput = z.infer<typeof SearchPatentsAdvancedSchema>

export async function searchPatentsAdvanced(
  api: KiprisApiClient,
  input: SearchPatentsAdvancedInput
): Promise<ToolResponse> {
  try {
    const label =
      [
        input.inventionTitle && `명칭:${input.inventionTitle}`,
        input.abstract && `초록:${input.abstract}`,
        input.claim && `청구:${input.claim}`,
        input.ipc && `IPC:${input.ipc}`,
        input.applicant && `출원인:${input.applicant}`,
        input.inventor && `발명자:${input.inventor}`,
      ]
        .filter(Boolean)
        .join(" ")

    const cacheKey = `adv:${label}:${input.patent}:${input.utility}:${input.numOfRows}:${input.pageNo}:${input.sortSpec}:${input.descSort}`
    const cached = patentCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

    const xml = await api.advancedSearch(
      {
        inventionTitle: input.inventionTitle,
        astrtCont: input.abstract,
        claimScope: input.claim,
        ipcNumber: input.ipc,
        applicant: input.applicant,
        inventor: input.inventor,
        patent: input.patent,
        utility: input.utility,
        numOfRows: input.numOfRows,
        pageNo: input.pageNo,
        descSort: input.descSort,
        sortSpec: input.sortSpec,
      },
      input.apiKey
    )

    if (checkHeader(xml)) return noResultHint(label, "항목검색", input.pageNo)
    const total = parseTotalCount(xml)
    const hits = parseAdvancedList(xml)
    if (hits.length === 0) return noResultHint(label, "항목검색", input.pageNo)

    const text = truncateResponse(formatSearchResult("🎯 항목검색", label, total, hits))
    patentCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "search_patents_advanced")
  }
}
