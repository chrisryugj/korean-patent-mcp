import type { z } from "zod"

/** MCP 도구 응답 표준 형태 */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

/** 도구 핸들러 시그니처 */
export type ToolHandler<TClient, TInput> = (
  apiClient: TClient,
  input: TInput
) => Promise<ToolResponse>

/** tool-registry 에 등록되는 도구 메타 */
export interface McpTool {
  name: string
  description: string
  // zod 스키마. 런타임 parse + JSON Schema 변환에 사용
  schema: z.ZodTypeAny
  handler: (apiClient: any, input: any) => Promise<ToolResponse>
}

/** 검색류(freeSearch/applicant/applicationNumber/rightHoler) 공통 결과 1건 */
export interface PatentHit {
  serialNumber: string
  inventionName: string
  applicant: string
  applicationNumber: string
  applicationDate: string
  openNumber: string
  openingDate: string
  publicNumber: string
  publicDate: string
  registrationNumber: string
  registrationDate: string
  registrationStatus: string
  ipc: string
  abstract: string
  drawingPath: string
  thumbnailPath: string
}

/** 상표 검색 결과 1건 (trademarkInfoSearchService) */
export interface TrademarkHit {
  title: string
  applicant: string
  applicationNumber: string
  applicationDate: string
  applicationStatus: string
  classificationCode: string
  registrationNumber: string
  registrationDate: string
  publicationNumber: string
  publicationDate: string
  rightHolder: string
  agent: string
  drawing: string
}

/** 디자인 검색 결과 1건 (designInfoSearchService) */
export interface DesignHit {
  articleName: string
  applicant: string
  applicationNumber: string
  applicationDate: string
  applicationStatus: string
  designMainClassification: string
  designNumber: string
  registrationNumber: string
  registrationDate: string
  agent: string
  inventor: string
  imagePath: string
}

/** 서지상세(getBibliographyDetailInfoSearch) 결과 */
export interface PatentDetail {
  applicationNumber: string
  applicationDate: string
  inventionTitle: string
  inventionTitleEng: string
  claimCount: string
  examinerName: string
  finalDisposal: string
  openNumber: string
  openDate: string
  publicationNumber: string
  publicationDate: string
  registerNumber: string
  registerDate: string
  registerStatus: string
  originalApplicationKind: string
  ipcList: string[]
  applicants: string[]
  inventors: string[]
  agents: string[]
  priorityList: string[]
}
