# Korean Patent MCP (KIPRIS)

특허청 **KIPRIS Plus** 오픈API를 MCP 도구로 노출하는 서버. 특허·실용신안·상표·디자인을 키워드/항목/출원인/권리자로 검색하고, 출원번호로 상세 서지정보를 조회한다.

> korean-law-mcp 아키텍처를 벤치마킹 — lib/tools 레이어 분리, fetch 재시도·키 마스킹, Zod 검증, stateless HTTP, TTL 캐시, 응답 크기 제한, `[NOT_FOUND]` 환각방지 패턴.

## 도구 (7)

| 도구 | 설명 | KIPRIS 오퍼레이션 |
|------|------|-------------------|
| `search_patents` | **자유검색** — 키워드로 특허·실용신안 통합검색 (발명명칭·초록·청구항·출원인) | `freeSearchInfo` |
| `search_patents_advanced` | **항목검색** — IPC·발명명칭·초록·청구범위·출원인·발명자 조합 정밀검색 | `getAdvancedSearch` |
| `search_by_applicant` | **출원인검색** — 기업·개인 출원인명으로 출원 목록 | `applicantNameSearchInfo` |
| `search_by_rightholder` | **권리자검색** — 현재 특허권 보유자(권리이전 반영) | `rightHolerSearchInfo` |
| `get_patent_detail` | **서지상세** — 출원번호 → 출원인·발명자·IPC·심사관·청구항수·최종처분·등록상태 | `getBibliographyDetailInfoSearch` (폴백 `applicationNumberSearchInfo`) |
| `search_trademark` | **상표검색** — 상표명 키워드 (출원상태·상품류·권리자·견본이미지) | `trademarkInfoSearchService/getWordSearch` |
| `search_design` | **디자인검색** — 물품명 키워드 (디자인분류·출원상태·도면이미지) | `designInfoSearchService/getWordSearch` |

## 원격 엔드포인트 (설치 없음)

공개 remote 서버가 떠 있어 설치 없이 바로 쓸 수 있다:

```
https://mcp.gomdori.app/patent
```

- claude.ai 커스텀 커넥터 URL로 붙여넣으면 끝 (자체 KIPRIS 키는 `kipris-key` 헤더로 전달 가능, 없으면 서버 공용 키 폴백)
- Claude Code: `claude mcp add --transport http korean-patent https://mcp.gomdori.app/patent`

## 설치 & 빌드

```bash
npm install
npm run build
```

## 인증키

KIPRIS Plus 인증키가 필요하다. [plus.kipris.or.kr](https://plus.kipris.or.kr) 회원가입 후
사용할 서비스(특허·실용 / 상표 / 디자인)를 각각 **활용신청**하면 단일 인증키로 모두 호출된다.
(data.go.kr 발급 키도 동일 키 체계.)

```bash
cp .env.example .env
# .env 에 KIPRIS_API_KEY=발급키 입력
```

> **권한은 오퍼레이션(상세기능) 단위**다. 신청하지 않은 기능은 `resultCode 30`(미등록)으로 거부된다.
> 예: 특허만 신청했다면 `search_trademark`/`search_design` 은 30 을 반환한다. 각 서비스를 추가 신청하면 즉시 동작한다.

## 실행

### STDIO (Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "korean-patent": {
      "command": "node",
      "args": ["/절대경로/korean-patent-mcp/build/index.js"],
      "env": { "KIPRIS_API_KEY": "발급키" }
    }
  }
}
```

### HTTP (stateless, 클라우드 배포)

```bash
node build/index.js --mode http --port 8000
# 키: 요청 헤더(apikey / x-api-key / kipris-key / Authorization: Bearer) 또는 서버 환경변수 폴백
```

키는 요청별(BYOK) 헤더가 우선이고, 없으면 서버 `KIPRIS_API_KEY` 로 폴백한다.
폴백 호출은 무료 한도(1,000회/월)를 보호해야 하는데, **실질 방어선은 분당이 아니라 일일 총량**이다
(분당 상한만으로는 하루 이론 최대가 월 한도를 수십 배 넘는다). 그래서 분당 게이트는 버스트 흡수용으로만
두고 총량은 `FALLBACK_DAILY_CAP`(기본 30 ≈ 1,000÷31)이 잡는다. 두 게이트 모두 `tools/call`만 계수하며,
핸드셰이크(`initialize`/`tools/list`)는 KIPRIS 쿼터를 쓰지 않으므로 계수하지 않는다 — 계수하면 커넥터가
붙을 때마다 쿼터가 깎여 **도구 목록조차 못 싣는다**.

**HTTP 모드 환경변수**

| 변수 | 기본 | 설명 |
|------|------|------|
| `CORS_ORIGIN` | `*` (경고) | 허용 도메인. 프로덕션은 명시 권장 |
| `RATE_LIMIT_RPM` | `60` | IP당 분당 `tools/call` 한도 |
| `FALLBACK_RATE_LIMIT_RPM` | `10` | 키 없는 요청의 서버 키 폴백 분당 상한(토큰버킷 — 연속 리필). `0`이면 폴백 차단(BYOK 강제) |
| `FALLBACK_RATE_LIMIT_BURST` | = RPM | 폴백 토큰버킷 용량(1분치) |
| `FALLBACK_DAILY_CAP` | `30` | 폴백의 롤링 24시간 총량 캡. `0`이면 비활성 |
| `MCP_MAX_BATCH_CALLS` | `20` | 단일 POST(JSON-RPC 배치)의 `tools/call` 최대 개수 |
| `TRUST_PROXY` | `1` | Express trust proxy 단수. `true`/`all`은 XFF 스푸핑 위험 |
| `MCP_BODY_LIMIT` | `100kb` | POST 본문 크기 한도 |

429 응답에는 `Retry-After` 헤더와 본문 대기 초 안내가 실린다.

Docker / Fly.io:

```bash
flyctl launch --dockerfile Dockerfile
flyctl secrets set KIPRIS_API_KEY=발급키
flyctl deploy
```

## 사용 예 (사용자 질의 → 도구)

| 사용자가 묻는 것 | 도구 호출 |
|------------------|-----------|
| "드론 배터리 관련 특허 찾아줘" | `search_patents(query="드론 배터리")` |
| "G06N 분류 AI 특허 중 삼성 것" | `search_patents_advanced(ipc="G06N", applicant="삼성")` |
| "발명명칭에 '폴더블' 들어간 특허" | `search_patents_advanced(inventionTitle="폴더블")` |
| "현대자동차가 출원한 특허 목록" | `search_by_applicant(applicant="현대자동차")` |
| "지금 LG가 보유한 특허" | `search_by_rightholder(rightHolder="LG전자")` |
| "이 출원번호 상세 정보" | `get_patent_detail(applicationNumber="10-2016-0172841")` |
| "카카오 상표 등록됐나?" | `search_trademark(query="카카오")` |
| "의자 디자인 등록 사례" | `search_design(query="의자")` |

**공통 옵션**
- `numOfRows` (1~100, 기본 10), `pageNo` (기본 1) — 페이징 지원
- `patent` / `utility` — 검색 대상 (특허/실용신안)
- `sortSpec` — `AD`(출원일) `OPD`(공개일) `GD`(공고일) `RD`(등록일) `PD`(우선일)
- `descSort` — 내림차순(최신순) 여부
- `withAbstract` — (자유검색) 초록 본문 포함

## 동작·한계 (실측 기준)

- **검색 연산자**: 자유검색어의 `+ * ? ! ^` 는 KIPRIS 검색연산자로 해석된다.
  예) `C++` 는 `+` 가 연산자로 작동해 의도와 다른 결과가 나올 수 있다. 정확검색은 항목검색(`search_patents_advanced`)을 사용.
- **해외특허**는 별도 서비스(`ForeignPatentAdvencedSearchService`)이며 현재 인증키에 미신청 상태(`resultCode 30`)라 미지원. 활용신청 시 도구 추가 가능.
- **응답 50KB 초과** 시 **항목 경계에서** 자동 절단(`⚠️` 표기) — 레코드가 중간에 끊겨 LLM 이 오인하는 것을 방지. 더 보려면 `numOfRows` 를 줄이거나 `pageNo` 로 페이징.
- **0건**은 `[NOT_FOUND]` 로 명시 반환 (LLM 환각 방지). 깊은 페이지(`pageNo>1`)의 0건은 "마지막 페이지 도달" 가능성을 별도 안내.
- **전송 보안**: KIPRIS 호출은 기본 `https`. 키가 쿼리스트링에 실리므로 평문 노출 방지. (`KIPRIS_API_PROTOCOL=http` 로만 평문 전환)

## resultCode (KIPRIS 공식)

| 코드 | 의미 | 대응 |
|------|------|------|
| 00 | 정상 | — |
| 10 / 11 | 파라미터 오류 / 필수누락 | 검색조건 확인 |
| 20 | 결과 없음 | 빈 결과로 정상 처리 |
| 30 | 인증키 미등록(서비스 미신청) | 해당 서비스 활용신청 |
| 31 | 인증키 사용기한 만료 | 연장/재발급 |

## 구조

```
src/
├── index.ts            진입점 (STDIO / HTTP 모드)
├── tool-registry.ts    도구 7개 등록 + Zod→JSON Schema 변환 (apiKey 숨김)
├── lib/
│   ├── api-client.ts       KIPRIS 엔드포인트 래핑 (openapi/rest + kipo-api)
│   ├── fetch-with-retry.ts 타임아웃·재시도·키 마스킹
│   ├── xml-parser.ts       헤더검사·검색목록·항목검색·상표·디자인·서지상세 파싱
│   ├── format.ts           도메인별 결과 텍스트 포맷팅
│   ├── errors.ts           KIPRIS resultCode 표준화 + 환각방지
│   ├── cache.ts            TTL+LRU 캐시
│   ├── schemas.ts          응답 크기 제한
│   ├── session-state.ts    요청별 키 격리 (AsyncLocalStorage)
│   └── types.ts
├── tools/              search / advanced / applicant / rightholder / detail / trademark / design
└── server/http-server.ts   Streamable HTTP (rate limit, CORS, trust proxy)
```

## 라이선스

MIT
