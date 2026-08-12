# CLAUDE.md

> ## ⚠️ 배포 — 통합 호스트 (2026-07-02부터)
>
> 프로덕션 공식 서빙은 **[gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합 호스트**(fly 앱 `korean-law-mcp` 1대, MCP 5종 동거)다.
> - 공식 주소: `https://mcp.gomdori.app/patent` (구 앱 `korean-patent-mcp`는 통합 완료로 **scale 0 처리됨**)
> - **반영 절차**: 이 레포는 npm 미배포 — main에 커밋·푸시한 뒤 `cd ~/workspace/gomdori-mcp && fly deploy -c fly.production.toml` (Dockerfile이 GitHub main을 clone해 빌드) → `curl https://mcp.gomdori.app/healthz` 확인
> - 구 앱은 scale 0이므로 이 레포에서 `fly deploy` 직접 실행은 무의미 — 통합 반영은 반드시 위 절차로


Korean Patent MCP — KIPRIS Plus 특허·실용신안·상표·디자인 검색 MCP (7툴). korean-law-mcp 패턴 벤치마킹.

## Structure

```
src/
├── index.ts            진입점 (STDIO/HTTP 모드 분기)
├── tool-registry.ts    도구 7개 등록 + toMcpInputSchema (Zod v4 → JSON Schema, apiKey 숨김)
├── lib/
│   ├── api-client.ts       KIPRIS 엔드포인트 래핑 (검색류/항목/상표/디자인/서지상세)
│   ├── fetch-with-retry.ts 30초 타임아웃·3회 재시도·maskSensitiveUrl
│   ├── xml-parser.ts       checkHeader / parsePatentList / parseAdvancedList / parseTrademarkList / parseDesignList / parsePatentDetail / parseTotalCount
│   ├── format.ts           PatentHit/Trademark/Design/Detail → 텍스트
│   ├── errors.ts           KiprisApiError + resultCode 표준화
│   ├── cache.ts            patentCache (TTL+LRU)
│   ├── schemas.ts          truncateResponse (50KB)
│   ├── session-state.ts    AsyncLocalStorage 요청별 키
│   └── types.ts
├── tools/              search / advanced / applicant / rightholder / detail / trademark / design
└── server/http-server.ts
```

## Tools (7)

search_patents(자유검색) / search_patents_advanced(항목검색 IPC·명칭·초록·청구·출원인·발명자) /
search_by_applicant / search_by_rightholder / get_patent_detail(서지상세) /
search_trademark / search_design

## Commands

```bash
npm run build
KIPRIS_API_KEY=키 node build/index.js              # STDIO
KIPRIS_API_KEY=키 node build/index.js --mode http --port 8000
```

## Domain Knowledge — KIPRIS 엔드포인트

두 게이트웨이가 있고 **키 필드·페이징 방식이 다르다**:

| 게이트웨이 | 키 필드 | 행수 | 페이징 | 오퍼레이션 |
|-----------|---------|------|--------|-----------|
| `openapi/rest/patUtiModInfoSearchSevice` | `accessKey` | `docsCount` | `docsStart`(1-base offset) | freeSearchInfo, applicantNameSearchInfo, rightHolerSearchInfo, applicationNumberSearchInfo |
| `kipo-api/kipi/patUtiModInfoSearchSevice` | `ServiceKey` | `numOfRows` | `pageNo` | getAdvancedSearch(항목검색), getBibliographyDetailInfoSearch(서지상세) |
| `kipo-api/kipi/trademarkInfoSearchService` | `ServiceKey` | `numOfRows` | `pageNo` | getWordSearch (파라미터 `searchString`) |
| `kipo-api/kipi/designInfoSearchService` | `ServiceKey` | `numOfRows` | `pageNo` | getWordSearch (파라미터 `articleName`) |

### 함정 (실측 2026-06-21)

1. **행수**: openapi/rest=`docsCount`, kipo-api=`numOfRows`. `numOfRows`/`docsCount` 둘 다 전송하면 안전(미지원측 무시). 안 맞추면 항상 기본 30건.
2. **페이징**: openapi/rest 는 `pageNo` 무시 → `docsStart=(page-1)*rows+1` 로 변환. kipo-api 는 `pageNo` 직접 동작. (api-client.buildSearchCommon 이 검색류 변환 담당)
3. **권한은 오퍼레이션 단위** — 신청 안 한 기능은 `resultCode 30`. 같은 키라도 freeSearchInfo 는 되고 getAdvancedSearch/상표/디자인은 30 일 수 있음. **해외특허(ForeignPatentAdvencedSearchService)는 현재 키 미신청(30)** → 도구 미포함.
4. **서비스명 오타가 공식** — `patUtiModInfoSearchSevice`(Sevice), `rightHolerSearchInfo`(Holer), `ForeignPatentAdvencedSearchService`(Advenced). 그대로 써야 함.
5. **검색 파라미터명**: 상표=`searchString`, 디자인=`articleName`(word/searchString 아님), 권리자=`rightHoler`.
6. **resultCode**: 00=정상, 10/11=파라미터오류, 20=결과없음(checkHeader가 true 반환→noResultHint), 30=키미등록, 31=기한만료.
7. **응답 필드 케이스 3종**: 검색류(freeSearch 등)=`PatentUtilityInfo` PascalCase; 항목/상표/디자인=`items.item` camelCase; 서지상세=`biblioSummaryInfo` camelCase. totalCount 도 검색류=`TotalSearchCount` / 나머지=`totalCount` 로 다름(parseTotalCount 가 둘 다 처리).
8. **검색연산자**: 자유검색어의 `+ * ? ! ^` 는 KIPRIS 연산자. `C++` 같은 입력은 깨짐 → 정확검색은 항목검색 사용. (sanitize 안 함 — 연산자 기능 보존)
9. **HTML 엔티티**: @xmldom/xmldom 이 textContent 에서 자동 디코딩(`&amp;`→`&`). 수동 처리 불필요.
10. **엔드포인트 도메인**: data.go.kr 발급 키는 `kipo-api.kipi.or.kr/openapi/service/...` 로도 동작하나, 본 구현은 `plus.kipris.or.kr` 게이트웨이 기준.
11. **프로토콜**: 기본 `https`(키가 쿼리스트링에 실려 평문 노출 방지). `KIPRIS_API_PROTOCOL=http` 로만 평문. https 실측 정상(2026-06-21).
12. **응답 절단**: `truncateResponse` 는 항목 경계(`\n\n`)에서 자른다 — 모든 포맷터가 항목을 `\n\n` 로 끝내는 데 의존. 포맷 변경 시 경계 유지.

## HTTP 모드 보안 (law-mcp 미러링)

- **BYOK + 폴백 상한**: 요청 헤더 키 우선, 없으면 서버 `KIPRIS_API_KEY` 폴백. 폴백은 토큰버킷 분당 상한(`FALLBACK_RATE_LIMIT_RPM`, 기본 10) + **롤링 일일 캡**(`FALLBACK_DAILY_CAP`, 기본 30 ≈ 1,000회/월 ÷ 31)으로 보호. `0`이면 폴백 차단(BYOK 강제).
- **★ 두 게이트 모두 `tools/call`만 계수** — 핸드셰이크(`initialize`/`tools/list`)를 계수하면 커넥터가 붙을 때마다 쿼터가 깎여 무키 사용자가 상시 429, 증상은 "도구 못 찾음"으로 나타난다(2026-08-12 실측: 무키 2발째 429). law-mcp v4.6.2/4.6.6과 동일한 수정. 배치는 `tools/call` 개수만큼 계수(`MCP_MAX_BATCH_CALLS` 상한 20).
- **월 한도는 분당 게이트로 못 지킨다** — 30rpm이면 하루 이론 최대 43,200으로 월 1,000을 수십 배 넘는다. 총량 방어는 반드시 일일 캡으로.
- CORS 미설정 시 `*` + 경고 로그. 보안헤더(X-Frame-Options/Referrer-Policy/X-Content-Type-Options). GET/DELETE `/mcp` → 405. SIGINT/SIGTERM graceful shutdown.
- 에러는 `scrubError`(메시지+스택 키 마스킹) 경유.

## Known (의도적 보류 — 버그 아님)

- 캐시 키에 apiKey 미포함 → BYOK 멀티테넌트에서 캐시 공유(공개 특허데이터라 기밀성 무관, law-mcp 동일). 키별 사용량 정밀 집계 필요 시 키 해시 prefix.
- `tool-registry.ts` `callHandler as any` → SDK ServerResult union(task 필드) 회피용. 런타임 안전(각 도구 자체 Zod parse).

## Critical Rules

1. 모든 도구 입력 Zod 검증, 최종 출력 `truncateResponse()`.
2. 에러는 `formatToolError()` 경유 (키 마스킹 + resultCode 해석).
3. 0건은 `noResultHint()` (LLM 환각 방지 [NOT_FOUND] 표지).
4. STDIO 모드에서 stdout 오염 금지 — 로그는 stderr.
5. 새 오퍼레이션 추가 시 api-client 에 메서드, xml-parser 에 파서, tools 에 핸들러, tool-registry 에 등록.

## Backlog

- 해외특허(ForeignPatentAdvencedSearchService) — 현재 키 미신청(30). 신청 시 도구 추가 (word+collectionValues+sortField, accessKey)
- 항목검색 출원일 범위(applicationDate from~to), 등록상태 필터(lastvalue)
- fly.io 실배포 (Dockerfile/fly.toml 준비됨)
