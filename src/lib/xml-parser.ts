import { DOMParser } from "@xmldom/xmldom"
import { KiprisApiError } from "./errors.js"
import type { PatentHit, PatentDetail, TrademarkHit, DesignHit } from "./types.js"

type El = ReturnType<DOMParser["parseFromString"]>

function parse(xml: string): El {
  return new DOMParser().parseFromString(xml, "text/xml")
}

/** 첫 번째 자식 태그의 textContent (trim). 없으면 빈 문자열 */
function text(node: any, tag: string): string {
  const el = node?.getElementsByTagName(tag)?.[0]
  return (el?.textContent || "").trim()
}

/** 같은 태그 전체를 문자열 배열로 */
function textList(node: any, tag: string): string[] {
  const out: string[] = []
  const nodes = node?.getElementsByTagName(tag)
  if (!nodes) return out
  for (let i = 0; i < nodes.length; i++) {
    const t = (nodes[i].textContent || "").trim()
    if (t) out.push(t)
  }
  return out
}

/**
 * KIPRIS 공통 헤더 검사. resultCode 가 00 이 아니면 KiprisApiError 를 던진다.
 * (단 20=검색결과없음 은 빈 결과로 정상 처리하도록 false 반환)
 * @returns 검색결과 0건이면 true
 */
export function checkHeader(xml: string): boolean {
  const doc = parse(xml)
  const code = text(doc as any, "resultCode")
  if (!code) {
    throw new KiprisApiError("99", "응답에 resultCode 가 없습니다(빈 응답일 수 있음)")
  }
  if (code === "00") return false
  if (code === "20") return true // 검색 결과 없음
  const msg = text(doc as any, "resultMsg")
  throw new KiprisApiError(code, msg)
}

/**
 * 총 검색건수 추출. 검색류(PatentUtilityInfo)는 <TotalSearchCount>,
 * 항목검색/상표/디자인(item)은 <totalCount> 를 쓴다 — 둘 다 시도.
 */
export function parseTotalCount(xml: string): number {
  const doc = parse(xml)
  const a = text(doc as any, "TotalSearchCount")
  if (a) return parseInt(a, 10) || 0
  const b = text(doc as any, "totalCount")
  return b ? parseInt(b, 10) || 0 : 0
}

/**
 * 검색류(freeSearchInfo/applicantNameSearchInfo/applicationNumberSearchInfo/
 * rightHolerSearchInfo) 응답을 PatentHit[] 로 파싱.
 * 각 결과는 <PatentUtilityInfo> 노드.
 */
export function parsePatentList(xml: string): PatentHit[] {
  const doc = parse(xml)
  const nodes = (doc as any).getElementsByTagName("PatentUtilityInfo")
  const out: PatentHit[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    out.push({
      serialNumber: text(n, "SerialNumber"),
      inventionName: text(n, "InventionName"),
      applicant: text(n, "Applicant"),
      applicationNumber: text(n, "ApplicationNumber"),
      applicationDate: text(n, "ApplicationDate"),
      openNumber: text(n, "OpeningNumber"),
      openingDate: text(n, "OpeningDate"),
      publicNumber: text(n, "PublicNumber"),
      publicDate: text(n, "PublicDate"),
      registrationNumber: text(n, "RegistrationNumber"),
      registrationDate: text(n, "RegistrationDate"),
      registrationStatus: text(n, "RegistrationStatus"),
      ipc: text(n, "InternationalpatentclassificationNumber"),
      abstract: text(n, "Abstract"),
      drawingPath: text(n, "DrawingPath"),
      thumbnailPath: text(n, "ThumbnailPath"),
    })
  }
  return out
}

/**
 * 항목검색(getAdvancedSearch) 응답을 PatentHit[] 로 파싱.
 * 결과는 <item> 노드이며 필드명이 검색류(PatentUtilityInfo)와 다르다(camelCase).
 */
export function parseAdvancedList(xml: string): PatentHit[] {
  const doc = parse(xml)
  const items = (doc as any).getElementsByTagName("items")?.[0]
  if (!items) return []
  const nodes = items.getElementsByTagName("item")
  const out: PatentHit[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    out.push({
      serialNumber: text(n, "indexNo"),
      inventionName: text(n, "inventionTitle"),
      applicant: text(n, "applicantName"),
      applicationNumber: text(n, "applicationNumber"),
      applicationDate: text(n, "applicationDate"),
      openNumber: text(n, "openNumber"),
      openingDate: text(n, "openDate"),
      publicNumber: text(n, "publicationNumber"),
      publicDate: text(n, "publicationDate"),
      registrationNumber: text(n, "registerNumber"),
      registrationDate: text(n, "registerDate"),
      registrationStatus: text(n, "registerStatus"),
      ipc: text(n, "ipcNumber"),
      abstract: text(n, "astrtCont"),
      drawingPath: text(n, "drawing"),
      thumbnailPath: text(n, "bigDrawing"),
    })
  }
  return out
}

/** 상표 검색(trademarkInfoSearchService) 응답 파싱 */
export function parseTrademarkList(xml: string): TrademarkHit[] {
  const doc = parse(xml)
  const items = (doc as any).getElementsByTagName("items")?.[0]
  if (!items) return []
  const nodes = items.getElementsByTagName("item")
  const out: TrademarkHit[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    out.push({
      title: text(n, "title"),
      applicant: text(n, "applicantName"),
      applicationNumber: text(n, "applicationNumber"),
      applicationDate: text(n, "applicationDate"),
      applicationStatus: text(n, "applicationStatus"),
      classificationCode: text(n, "classificationCode"),
      registrationNumber: text(n, "registrationNumber"),
      registrationDate: text(n, "registrationDate"),
      publicationNumber: text(n, "publicationNumber"),
      publicationDate: text(n, "publicationDate"),
      rightHolder: text(n, "regPrivilegeName"),
      agent: text(n, "agentName"),
      drawing: text(n, "drawing"),
    })
  }
  return out
}

/** 디자인 검색(designInfoSearchService) 응답 파싱 */
export function parseDesignList(xml: string): DesignHit[] {
  const doc = parse(xml)
  const items = (doc as any).getElementsByTagName("items")?.[0]
  if (!items) return []
  const nodes = items.getElementsByTagName("item")
  const out: DesignHit[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    out.push({
      articleName: text(n, "articleName"),
      applicant: text(n, "applicantName"),
      applicationNumber: text(n, "applicationNumber"),
      applicationDate: text(n, "applicationDate"),
      applicationStatus: text(n, "applicationStatus"),
      designMainClassification: text(n, "designMainClassification"),
      designNumber: text(n, "designNumber"),
      registrationNumber: text(n, "registrationNumber"),
      registrationDate: text(n, "registrationDate"),
      agent: text(n, "agentName"),
      inventor: text(n, "inventorName"),
      imagePath: text(n, "imagePath"),
    })
  }
  return out
}

/**
 * 서지상세(getBibliographyDetailInfoSearch) 응답 파싱.
 * body.item 안에 biblioSummaryInfoArray / ipcInfoArray / applicantInfoArray 등.
 */
export function parsePatentDetail(xml: string): PatentDetail | null {
  const doc = parse(xml)
  const summary = (doc as any).getElementsByTagName("biblioSummaryInfo")?.[0]
  if (!summary) return null
  return {
    applicationNumber: text(summary, "applicationNumber"),
    applicationDate: text(summary, "applicationDate"),
    inventionTitle: text(summary, "inventionTitle"),
    inventionTitleEng: text(summary, "inventionTitleEng"),
    claimCount: text(summary, "claimCount"),
    examinerName: text(summary, "examinerName"),
    finalDisposal: text(summary, "finalDisposal"),
    openNumber: text(summary, "openNumber"),
    openDate: text(summary, "openDate"),
    publicationNumber: text(summary, "publicationNumber"),
    publicationDate: text(summary, "publicationDate"),
    registerNumber: text(summary, "registerNumber"),
    registerDate: text(summary, "registerDate"),
    registerStatus: text(summary, "registerStatus"),
    originalApplicationKind: text(summary, "originalApplicationKind"),
    ipcList: textList((doc as any).getElementsByTagName("ipcInfoArray")?.[0], "ipcNumber"),
    applicants: textList((doc as any).getElementsByTagName("applicantInfoArray")?.[0], "name"),
    inventors: textList((doc as any).getElementsByTagName("inventorInfoArray")?.[0], "name"),
    agents: textList((doc as any).getElementsByTagName("agentInfoArray")?.[0], "name"),
    priorityList: textList(
      (doc as any).getElementsByTagName("priorityInfoArray")?.[0],
      "priorityApplicationNumber"
    ),
  }
}
