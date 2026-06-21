# 프로덕션 리뷰 핸드오프 — korean-patent-mcp

> 다음 세션이 이 문서만 읽고 프로덕션 리뷰를 바로 시작할 수 있도록 준비한 핸드오프.
> 작성: 2026-06-21 (v0.2.0). 대상: korean-law-mcp 운영 수준으로 끌어올리기.

## ✅ 리뷰 완료 (v0.2.1, 2026-06-21)

security-reviewer + code-reviewer 2종 + HTTP 실호출 스모크로 리뷰 수행, 출시 차단급 수정 완료.

| 처리 | 내용 |
|------|------|
| ✅ 전송보안 | KIPRIS 호출 기본 `https` 전환(키 쿼리스트링 평문 노출 차단). `KIPRIS_API_PROTOCOL` env 실연결. https 실측 정상 |
| ✅ 경계보존 절단 | `truncateResponse` 항목 경계(`\n\n`)에서 절단 — 레코드 중간 절단 환각 위험 제거 |
| ✅ total<hits 가드 | 검색 포맷터 3종 `Math.max(total, hits)` — 총건수 0 표기 모순 제거 |
| ✅ HTTP 폴백 상한 | `FALLBACK_RATE_LIMIT_RPM` 전역 캡 — 키 없는 분산 요청의 서버 키 한도 고갈 차단(law-mcp 미러링) |
| ✅ HTTP 강화 | CORS 미설정 경고, 보안헤더, GET/DELETE 405, graceful shutdown, 0.0.0.0 바인딩, scrubError |
| ✅ HTML 에러 감지 | KIPRIS 200+HTML 에러페이지 명시 구분 |
| ✅ 깊은 페이징 | `pageNo>1` 0건은 "마지막 페이지 도달" 별도 안내 |
| ✅ HTTP 실호출 검증 | StreamableHTTP initialize+tools/list 7툴 end-to-end 확인 |

**남은 단일 게이트 — KIPRIS 키 (사용자 조치 필수)**:
- 🔑 이전 세션 대화에 평문 노출된 키 **재발급**(plus.kipris.or.kr) → 이게 없으면 라이브 `npm test`(18종)와 fly 배포 불가.
- 재발급 키로: `KIPRIS_API_KEY=키 npm test` (18/18 기대) → `flyctl secrets set KIPRIS_API_KEY=키` → `flyctl deploy`.

> 의도적 보류(버그 아님): 캐시키 apiKey 해시(공개데이터, law-mcp 동일), `as any`(SDK union 회피, 런타임 안전). 상세는 CLAUDE.md Known.

## 0. 30초 현황

- KIPRIS Plus 특허·실용·상표·디자인 검색 MCP, **7툴**, TypeScript, law-mcp 아키텍처 벤치마킹.
- 빌드 통과, **실키 시나리오 18/18 통과** (`npm test`).
- STDIO 모드 검증 완료. **HTTP 모드·fly 배포는 미검증.**
- 기능·엣지는 견고. 남은 건 **운영 안전성(보안/배포/부하)** 리뷰.

## 1. 리뷰 재현 (먼저 이거부터)

```bash
cd ~/workspace/korean-patent-mcp
npm install && npm run build
KIPRIS_API_KEY=<키> npm test          # 시나리오 18종 — 전부 ✓ 떠야 정상
```

> ⚠️ 이 레포 작업 이력의 KIPRIS 키는 **세션 대화에 평문 노출**됐다. 리뷰 첫 항목이 키 재발급(아래 P0).

## 2. 프로덕션 리뷰 체크리스트

체크 안 된 항목 = 다음 세션이 점검/결정할 것.

### P0 — 운영 전 필수
- [ ] **API 키 재발급** — 현재 키 노출됨. plus.kipris.or.kr 에서 재발급 후 fly secret/.env 교체.
- [ ] **HTTP 모드 CORS** — 기본 `*`. 프로덕션 도메인으로 `CORS_ORIGIN` 지정.
- [ ] **HTTP 모드 실호출 검증** — `--mode http` 로 띄워 `/mcp` POST + `/health` 확인 (StreamableHTTPServerTransport 경로 미검증).

### P1 — 신뢰성
- [x] fetch 타임아웃 30s + 재시도 3회 (`fetch-with-retry.ts`)
- [x] resultCode 30/31/11/20 처리 (`errors.ts`, `xml-parser.checkHeader`)
- [x] API 키 마스킹 (`maskSensitiveUrl`)
- [ ] **빈응답/HTML 에러 감지** — 빈 본문은 막음. KIPRIS 장애 시 HTML 반환 가능성 → `checkHeader` 가 `resultCode` 없으면 99 throw 하므로 부분 방어. HTML 에러페이지 케이스 실측 필요.
- [ ] **무료 한도 1,000회/월** — 캐시(1h)로 완화하나 호출량 모니터링·초과 시 동작 미검토.
- [ ] **깊은 페이징** — `docsStart` 큰 값(예: pageNo=300) 동작/성능 미검증.
- [ ] 동시 요청/경쟁 상태 (stateless HTTP, 캐시 동시성).

### P2 — 성능·품질
- [x] TTL+LRU 캐시 (1h, 300엔트리)
- [ ] **응답 절단** — `truncateResponse` 는 50KB 에서 항목 중간을 자른다. law-mcp `truncateSections` 같은 경계보존 방식 검토.
- [ ] **`as any` 캐스팅** — `tool-registry.ts` CallTool 핸들러. SDK 최신 union(task 필드) 회피용. 타입 정합 재검토.
- [ ] 단일 결과 정규화 — XML `getElementsByTagName` 이라 0/1/N 모두 안전하나 1건 응답 한번 더 확인.

### 기능 갭 (백로그, 리뷰에서 우선순위 결정)
- [ ] 해외특허 — 현재 키 미신청(30). 신청 시: `ForeignPatentAdvencedSearchService/freeSearch`, accessKey, 필수파라미터 `word + collectionValues(US/EP/JP/WO) + sortField`.
- [ ] 항목검색 출원일 범위(`applicationDate` from~to), 등록상태 필터(`lastvalue`).
- [ ] 상표/디자인 서지상세 (현재 목록 검색만).

## 3. 알려진 동작·한계 (의도된 것 — 버그 아님)

| 항목 | 내용 |
|------|------|
| 검색연산자 | 자유검색어 `+ * ? ! ^` 는 KIPRIS 연산자. `C++` → `+` 작동해 결과 폭증(527만건). 정확검색은 `search_patents_advanced`. sanitize 안 함(연산자 기능 보존). |
| 게이트웨이 2종 | openapi/rest(accessKey, docsCount, docsStart) vs kipo-api(ServiceKey, numOfRows, pageNo). 페이징 변환은 `api-client.buildSearchCommon`. |
| 권한 단위 | 오퍼레이션별. 미신청 = resultCode 30. |
| 서비스명 오타 | `...Sevice`, `rightHoler`, `...Advenced` — KIPRIS 공식 철자. 수정 금지. |

## 4. 리뷰 수행 제안

```
1) npm test 로 회귀 확인 (그린 베이스라인)
2) security-reviewer 서브에이전트 → src/ (키·CORS·rate limit·입력검증)
3) code-reviewer 서브에이전트 → src/lib (에러처리·캐시·파싱 엣지)
4) HTTP 모드 수동 기동 + curl 스모크
5) P0 3건 처리 → fly 배포 리허설
```

## 5. 파일 가이드

| 영역 | 파일 |
|------|------|
| 엔드포인트·키·페이징 | `src/lib/api-client.ts` |
| 파싱(3종 케이스) | `src/lib/xml-parser.ts` |
| 에러·resultCode | `src/lib/errors.ts` |
| 도구 7개 | `src/tools/*.ts` |
| 등록·스키마변환 | `src/tool-registry.ts` |
| HTTP 서버 | `src/server/http-server.ts` |
| 함정 상세 | `CLAUDE.md` |
| 회귀 테스트 | `test/run-scenarios.mjs` (`npm test`) |
