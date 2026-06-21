import { fetchWithRetry } from "./fetch-with-retry.js"
import { requestContext } from "./session-state.js"

/**
 * KIPRIS Plus 특허·실용신안 정보검색 서비스 엔드포인트.
 *
 * 두 게이트웨이가 존재한다:
 *  - openapi/rest  : accessKey 필드. freeSearch/applicant/applicationNumber/rightHoler.
 *  - kipo-api/kipi : ServiceKey 필드. 서지상세(getBibliographyDetailInfoSearch) 등.
 * 권한은 KIPRIS 상세기능(오퍼레이션) 단위로 부여된다.
 */
// 기본 https — accessKey/ServiceKey 가 쿼리스트링에 실리므로 평문 HTTP 는 전송 중 노출 위험.
// KIPRIS_API_PROTOCOL=http 로 명시할 때만 평문 사용.
const PROTO = process.env.KIPRIS_API_PROTOCOL === "http" ? "http" : "https"
const HOST = `${PROTO}://plus.kipris.or.kr`
const REST_BASE = `${HOST}/openapi/rest/patUtiModInfoSearchSevice`
const KIPO_BASE = `${HOST}/kipo-api/kipi/patUtiModInfoSearchSevice`
const TRADEMARK_BASE = `${HOST}/kipo-api/kipi/trademarkInfoSearchService`
const DESIGN_BASE = `${HOST}/kipo-api/kipi/designInfoSearchService`

/** 항목검색(getAdvancedSearch) 항목별 파라미터 */
export interface AdvancedParams {
  inventionTitle?: string
  astrtCont?: string
  claimScope?: string
  ipcNumber?: string
  applicant?: string
  inventor?: string
  applicationNumber?: string
  patent?: boolean
  utility?: boolean
  numOfRows?: number
  pageNo?: number
  descSort?: boolean
  sortSpec?: string
}

export interface SearchParams {
  word?: string
  applicant?: string
  rightHoler?: string
  applicationNumber?: string
  patent?: boolean
  utility?: boolean
  numOfRows?: number
  pageNo?: number
  descSort?: boolean
  sortSpec?: string
  lastvalue?: string
}

export class KiprisApiClient {
  private defaultApiKey: string

  constructor(config: { apiKey: string }) {
    this.defaultApiKey = config.apiKey
  }

  /** 키 해결 순서: override > 요청 컨텍스트 > 환경변수 > 생성자 기본값 */
  private getApiKey(overrideKey?: string): string {
    const ctx = requestContext.getStore()?.apiKey
    const key = overrideKey || ctx || process.env.KIPRIS_API_KEY || this.defaultApiKey
    if (!key) {
      throw new Error(
        "KIPRIS 인증키가 필요합니다. .env 의 KIPRIS_API_KEY 또는 요청 헤더로 전달하세요."
      )
    }
    return key
  }

  private buildQuery(
    params: Record<string, string | number | boolean | undefined>,
    keyField: string,
    apiKey: string
  ): string {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === "" || v === null) continue
      sp.append(k, String(v))
    }
    sp.append(keyField, apiKey)
    return sp.toString()
  }

  private async get(url: string, label: string): Promise<string> {
    const res = await fetchWithRetry(url)
    if (!res.ok) {
      if (res.status === 429) throw new Error(`${label}: API 한도 초과 (429)`)
      if (res.status >= 500) throw new Error(`${label}: 서버 오류 (${res.status})`)
      throw new Error(`${label}: API 오류 (${res.status})`)
    }
    const text = await res.text()
    const trimmed = text.trim()
    if (!trimmed) throw new Error(`${label}: 빈 응답 (일시적 장애일 수 있음)`)
    // KIPRIS 장애 시 200 OK 로 HTML 에러페이지를 반환하기도 한다(점검/게이트웨이 오류).
    // XML 이 아닌 HTML 은 파싱 단계에서 모호하게 실패하므로 여기서 명확히 구분한다.
    const head = trimmed.slice(0, 200).toLowerCase()
    if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
      throw new Error(`${label}: KIPRIS 서비스 오류 응답(HTML) — 일시적 장애일 수 있습니다.`)
    }
    return text
  }

  // --- openapi/rest 계열 (accessKey) ---

  private buildSearchCommon(p: SearchParams): Record<string, string | number | undefined> {
    const rows = p.numOfRows ?? 10
    const page = p.pageNo ?? 1
    return {
      patent: p.patent === false ? "false" : "true",
      utility: p.utility === false ? "false" : "true",
      // openapi/rest 계열: 행수=docsCount, 페이징=docsStart(1-base offset).
      // numOfRows/pageNo 는 무시되므로 docsStart 로 변환한다.
      docsCount: rows,
      docsStart: (page - 1) * rows + 1,
      descSort: p.descSort ? "true" : "false",
      sortSpec: p.sortSpec ?? "AD",
      lastvalue: p.lastvalue,
    }
  }

  /** 자유검색 */
  async freeSearch(p: SearchParams, apiKey?: string): Promise<string> {
    const q = this.buildQuery(
      { word: p.word, ...this.buildSearchCommon(p) },
      "accessKey",
      this.getApiKey(apiKey)
    )
    return this.get(`${REST_BASE}/freeSearchInfo?${q}`, "freeSearch")
  }

  /** 출원인 검색 */
  async applicantSearch(p: SearchParams, apiKey?: string): Promise<string> {
    const q = this.buildQuery(
      { applicant: p.applicant, ...this.buildSearchCommon(p) },
      "accessKey",
      this.getApiKey(apiKey)
    )
    return this.get(`${REST_BASE}/applicantNameSearchInfo?${q}`, "applicantSearch")
  }

  /** 권리자(최종권리자) 검색 */
  async rightHolderSearch(p: SearchParams, apiKey?: string): Promise<string> {
    const q = this.buildQuery(
      { rightHoler: p.rightHoler, ...this.buildSearchCommon(p) },
      "accessKey",
      this.getApiKey(apiKey)
    )
    return this.get(`${REST_BASE}/rightHolerSearchInfo?${q}`, "rightHolderSearch")
  }

  /** 출원번호 검색 (단건 조회용) */
  async applicationNumberSearch(applicationNumber: string, apiKey?: string): Promise<string> {
    const q = this.buildQuery(
      { applicationNumber },
      "accessKey",
      this.getApiKey(apiKey)
    )
    return this.get(
      `${REST_BASE}/applicationNumberSearchInfo?${q}`,
      "applicationNumberSearch"
    )
  }

  // --- kipo-api/kipi 계열 (ServiceKey) ---

  /** 서지상세 — 출원번호로 상세 서지/IPC/심사정보 조회 */
  async bibliographyDetail(applicationNumber: string, apiKey?: string): Promise<string> {
    const q = this.buildQuery(
      { applicationNumber },
      "ServiceKey",
      this.getApiKey(apiKey)
    )
    return this.get(
      `${KIPO_BASE}/getBibliographyDetailInfoSearch?${q}`,
      "bibliographyDetail"
    )
  }

  /** 항목별 정밀검색 (IPC·발명명칭·초록·출원인·발명자 조합) */
  async advancedSearch(p: AdvancedParams, apiKey?: string): Promise<string> {
    const q = this.buildQuery(
      {
        inventionTitle: p.inventionTitle,
        astrtCont: p.astrtCont,
        claimScope: p.claimScope,
        ipcNumber: p.ipcNumber,
        applicant: p.applicant,
        inventor: p.inventor,
        applicationNumber: p.applicationNumber,
        patent: p.patent === false ? "false" : "true",
        utility: p.utility === false ? "false" : "true",
        // kipo-api 계열 행수 — numOfRows/docsCount 둘 다 전송(미지원측은 무시)
        numOfRows: p.numOfRows ?? 10,
        docsCount: p.numOfRows ?? 10,
        pageNo: p.pageNo ?? 1,
        descSort: p.descSort ? "true" : "false",
        sortSpec: p.sortSpec ?? "AD",
      },
      "ServiceKey",
      this.getApiKey(apiKey)
    )
    return this.get(`${KIPO_BASE}/getAdvancedSearch?${q}`, "advancedSearch")
  }

  /** 상표 검색 */
  async trademarkSearch(
    p: { searchString: string; numOfRows?: number; pageNo?: number },
    apiKey?: string
  ): Promise<string> {
    const q = this.buildQuery(
      {
        searchString: p.searchString,
        numOfRows: p.numOfRows ?? 10,
        docsCount: p.numOfRows ?? 10,
        pageNo: p.pageNo ?? 1,
      },
      "ServiceKey",
      this.getApiKey(apiKey)
    )
    return this.get(`${TRADEMARK_BASE}/getWordSearch?${q}`, "trademarkSearch")
  }

  /** 디자인 검색 (물품명 기준) */
  async designSearch(
    p: { articleName: string; numOfRows?: number; pageNo?: number },
    apiKey?: string
  ): Promise<string> {
    const q = this.buildQuery(
      {
        articleName: p.articleName,
        numOfRows: p.numOfRows ?? 10,
        docsCount: p.numOfRows ?? 10,
        pageNo: p.pageNo ?? 1,
      },
      "ServiceKey",
      this.getApiKey(apiKey)
    )
    return this.get(`${DESIGN_BASE}/getWordSearch?${q}`, "designSearch")
  }
}
