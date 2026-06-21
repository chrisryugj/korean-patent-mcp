#!/usr/bin/env node
/**
 * 사용자 관점 시나리오 전수 테스트 (MCP stdio 프로토콜).
 *
 *   KIPRIS_API_KEY=키 node test/run-scenarios.mjs
 *
 * build/ 가 최신이어야 한다 (npm run build 선행).
 * 실 API 를 호출하므로 네트워크·키·KIPRIS 가동 상태에 의존한다.
 * totalCount 등 정확한 수치는 시점에 따라 변하므로, 상태(OK/ERR)와
 * 결과 유무·건수만 단언한다.
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ENTRY = join(ROOT, "build", "index.js")

if (!process.env.KIPRIS_API_KEY) {
  console.error("✗ KIPRIS_API_KEY 환경변수가 필요합니다.")
  process.exit(2)
}

function callTool(name, args) {
  return new Promise((resolve) => {
    const child = spawn("node", [ENTRY], {
      env: process.env,
      stdio: ["pipe", "pipe", "ignore"],
    })
    let out = ""
    child.stdout.on("data", (d) => (out += d))
    const timer = setTimeout(() => child.kill(), 60000)
    child.on("close", () => {
      clearTimeout(timer)
      for (const line of out.trim().split("\n")) {
        try {
          const r = JSON.parse(line)
          if (r.id === 2 && r.result) {
            return resolve({
              isError: !!r.result.isError,
              text: r.result.content?.[0]?.text ?? "",
            })
          }
        } catch {}
      }
      resolve({ isError: true, text: "(no response)" })
    })
    const msgs = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
    ]
    child.stdin.write(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n")
    child.stdin.end()
  })
}

const countHits = (t) => (t.match(/^\d+\.\s/gm) || []).length

// [이름, 도구, 인자, 기대(predicate)]
const cases = [
  ["자유검색 기본", "search_patents", { query: "드론", numOfRows: 3 }, (r) => !r.isError && countHits(r.text) === 3],
  ["자유검색 초록포함", "search_patents", { query: "폴더블 디스플레이", numOfRows: 2, withAbstract: true }, (r) => !r.isError && r.text.includes("초록:")],
  ["실용신안만", "search_patents", { query: "우산", patent: false, utility: true, numOfRows: 2 }, (r) => !r.isError],
  ["등록일정렬", "search_patents", { query: "전기차 배터리", sortSpec: "RD", numOfRows: 2 }, (r) => !r.isError],
  ["행수경계 100", "search_patents", { query: "드론", numOfRows: 100 }, (r) => !r.isError && countHits(r.text) === 100],
  ["페이징 p2≠p1", "search_patents", { query: "드론", numOfRows: 3, pageNo: 2 }, (r) => !r.isError && countHits(r.text) === 3],
  ["항목검색 IPC", "search_patents_advanced", { ipc: "G06N", numOfRows: 3 }, (r) => !r.isError && countHits(r.text) === 3],
  ["항목검색 명칭+출원인", "search_patents_advanced", { inventionTitle: "카메라", applicant: "삼성", numOfRows: 2 }, (r) => !r.isError],
  ["항목검색 조건없음→거부", "search_patents_advanced", { numOfRows: 2 }, (r) => r.isError && r.text.includes("INVALID")],
  ["출원인검색", "search_by_applicant", { applicant: "현대자동차", numOfRows: 3 }, (r) => !r.isError && countHits(r.text) === 3],
  ["권리자검색", "search_by_rightholder", { rightHolder: "삼성전자", numOfRows: 2 }, (r) => !r.isError],
  ["서지상세 하이픈", "get_patent_detail", { applicationNumber: "10-2016-0172841" }, (r) => !r.isError && r.text.includes("드론 시스템")],
  ["서지상세 존재안함", "get_patent_detail", { applicationNumber: "1099999999999" }, (r) => r.isError && r.text.includes("NOT_FOUND")],
  ["상표검색", "search_trademark", { query: "카카오", numOfRows: 3 }, (r) => !r.isError && countHits(r.text) === 3],
  ["디자인검색", "search_design", { query: "의자", numOfRows: 3 }, (r) => !r.isError && countHits(r.text) === 3],
  ["빈결과", "search_patents", { query: "asdfqwerzxcv없는검색어99", numOfRows: 2 }, (r) => r.isError && r.text.includes("NOT_FOUND")],
  ["타입오류 거부", "search_patents", { query: "드론", numOfRows: "three" }, (r) => r.isError && r.text.includes("INVALID")],
  ["행수초과 거부", "search_patents", { query: "드론", numOfRows: 200 }, (r) => r.isError && r.text.includes("INVALID")],
]

let pass = 0
let fail = 0
for (const [name, tool, args, predicate] of cases) {
  const r = await callTool(tool, args)
  let ok = false
  try {
    ok = predicate(r)
  } catch {}
  if (ok) pass++
  else fail++
  const first = r.text.split("\n")[0].slice(0, 50)
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(22)} ${r.isError ? "ERR" : "OK "} ${first}`)
}
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail === 0 ? 0 : 1)
