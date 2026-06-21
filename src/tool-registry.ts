import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { KiprisApiClient } from "./lib/api-client.js"
import type { McpTool } from "./lib/types.js"
import { formatToolError } from "./lib/errors.js"

import { searchPatents, SearchPatentsSchema } from "./tools/search.js"
import { searchPatentsAdvanced, SearchPatentsAdvancedSchema } from "./tools/advanced.js"
import { searchByApplicant, SearchByApplicantSchema } from "./tools/applicant.js"
import { searchByRightHolder, SearchByRightHolderSchema } from "./tools/rightholder.js"
import { getPatentDetail, GetPatentDetailSchema } from "./tools/detail.js"
import { searchTrademark, SearchTrademarkSchema } from "./tools/trademark.js"
import { searchDesign, SearchDesignSchema } from "./tools/design.js"

export const allTools: McpTool[] = [
  {
    name: "search_patents",
    description:
      "[자유검색] 키워드로 특허·실용신안 통합검색 (발명명칭·초록·청구항·출원인). 가장 일반적인 검색.",
    schema: SearchPatentsSchema,
    handler: searchPatents,
  },
  {
    name: "search_patents_advanced",
    description:
      "[항목검색] IPC분류·발명명칭·초록·청구범위·출원인·발명자를 조합한 정밀검색. 특정 기술분야 좁혀서 찾을 때.",
    schema: SearchPatentsAdvancedSchema,
    handler: searchPatentsAdvanced,
  },
  {
    name: "search_by_applicant",
    description: "[출원인검색] 기업·개인 출원인명으로 출원 특허 목록 조회. 예: '삼성전자'.",
    schema: SearchByApplicantSchema,
    handler: searchByApplicant,
  },
  {
    name: "search_by_rightholder",
    description: "[권리자검색] 현재 특허권을 보유한 최종권리자명으로 조회 (권리 이전 반영).",
    schema: SearchByRightHolderSchema,
    handler: searchByRightHolder,
  },
  {
    name: "get_patent_detail",
    description:
      "[서지상세] 출원번호로 상세 서지정보 조회 (출원인·발명자·IPC·청구항수·심사관·최종처분·등록상태).",
    schema: GetPatentDetailSchema,
    handler: getPatentDetail,
  },
  {
    name: "search_trademark",
    description: "[상표검색] 상표명 키워드로 검색 (출원상태·상품류·권리자·견본이미지). 예: '카카오'.",
    schema: SearchTrademarkSchema,
    handler: searchTrademark,
  },
  {
    name: "search_design",
    description: "[디자인검색] 물품명 키워드로 디자인 검색 (디자인분류·출원상태·도면이미지). 예: '의자'.",
    schema: SearchDesignSchema,
    handler: searchDesign,
  },
]

const toolMap = new Map<string, McpTool>(allTools.map((t) => [t.name, t]))

/** Zod 스키마 → MCP inputSchema(JSON Schema). apiKey 는 광고에서 숨김 */
export function toMcpInputSchema(schema: z.ZodTypeAny) {
  // io:"input" — .default() 필드가 required 로 직렬화되는 것 방지
  const raw = z.toJSONSchema(schema, { io: "input" }) as any
  if (raw?.type === "object" && raw?.properties) {
    const props = { ...raw.properties }
    delete props.apiKey
    const required = Array.isArray(raw.required)
      ? raw.required.filter((k: string) => k !== "apiKey")
      : []
    return {
      type: "object",
      properties: props,
      required,
      additionalProperties: raw.additionalProperties ?? false,
    }
  }
  return raw
}

export const TOOL_COUNTS = { total: allTools.length }

export function registerTools(server: Server, apiClient: KiprisApiClient) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toMcpInputSchema(t.schema),
    })),
  }))

  // ToolResponse 는 SDK ServerResult 와 구조 호환 — SDK 최신 union 의 task 필드 회피용 캐스팅
  const callHandler = async (request: { params: { name: string; arguments?: unknown } }) => {
    const { name, arguments: args } = request.params
    const tool = toolMap.get(name)
    if (!tool) {
      return {
        content: [{ type: "text", text: `[ERROR] 도구 '${name}'를 찾을 수 없습니다.` }],
        isError: true,
      }
    }
    try {
      const validated = tool.schema.parse(args ?? {})
      return await tool.handler(apiClient, validated)
    } catch (error) {
      return formatToolError(error, name)
    }
  }
  server.setRequestHandler(CallToolRequestSchema, callHandler as any)
}
