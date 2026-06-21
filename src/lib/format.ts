import type { PatentHit, PatentDetail, TrademarkHit, DesignHit } from "./types.js"

/** YYYYMMDD → YYYY.MM.DD (이미 점 포함이면 그대로) */
function fmtDate(d: string): string {
  if (!d) return ""
  if (d.includes(".")) return d
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`
  return d
}

/** 상태 이모지 */
function statusMark(s: string): string {
  if (s.includes("등록")) return "✅"
  if (s.includes("거절") || s.includes("소멸") || s.includes("포기") || s.includes("무효")) return "❌"
  if (s.includes("공개") || s.includes("심사")) return "🔎"
  return "•"
}

/** 검색 결과 1건 요약 라인 */
export function formatHit(idx: number, h: PatentHit, withAbstract = false): string {
  let s = `${idx}. ${statusMark(h.registrationStatus)} ${h.inventionName || "(제목없음)"}`
  if (h.registrationStatus) s += `  [${h.registrationStatus}]`
  s += "\n"
  if (h.applicant) s += `   - 출원인: ${h.applicant}\n`
  s += `   - 출원번호: ${h.applicationNumber}`
  if (h.applicationDate) s += ` (${fmtDate(h.applicationDate)})`
  s += "\n"
  if (h.registrationNumber) s += `   - 등록번호: ${h.registrationNumber} (${fmtDate(h.registrationDate)})\n`
  else if (h.openNumber) s += `   - 공개번호: ${h.openNumber} (${fmtDate(h.openingDate)})\n`
  if (h.ipc) s += `   - IPC: ${h.ipc.split("|").slice(0, 5).join(", ")}\n`
  if (withAbstract && h.abstract) {
    const abs = h.abstract.length > 300 ? h.abstract.slice(0, 300) + "…" : h.abstract
    s += `   - 초록: ${abs}\n`
  }
  if (h.drawingPath) s += `   - 대표도면: ${h.drawingPath}\n`
  return s + "\n"
}

/** 검색 결과 전체 포맷팅 */
export function formatSearchResult(
  label: string,
  query: string,
  total: number,
  hits: PatentHit[],
  withAbstract = false
): string {
  // totalCount 태그가 누락된 변형 응답에서 total=0 이 되면 hits 건수와 모순되므로 보정
  const t = Math.max(total, hits.length)
  let out = `${label} "${query}" — 총 ${t.toLocaleString()}건`
  if (hits.length < t) out += ` (상위 ${hits.length}건 표시)`
  out += "\n\n"
  hits.forEach((h, i) => {
    out += formatHit(i + 1, h, withAbstract)
  })
  if (hits.length > 0) {
    out += `💡 상세: get_patent_detail(applicationNumber="${hits[0].applicationNumber}")\n`
  }
  return out
}

/** 상표 검색 결과 포맷팅 */
export function formatTrademarkResult(
  query: string,
  total: number,
  hits: TrademarkHit[]
): string {
  const t = Math.max(total, hits.length)
  let out = `™️ 상표검색 "${query}" — 총 ${t.toLocaleString()}건`
  if (hits.length < t) out += ` (상위 ${hits.length}건 표시)`
  out += "\n\n"
  hits.forEach((h, i) => {
    out += `${i + 1}. ${statusMark(h.applicationStatus)} ${h.title || "(명칭없음)"}`
    if (h.applicationStatus) out += `  [${h.applicationStatus}]`
    out += "\n"
    if (h.applicant) out += `   - 출원인: ${h.applicant}\n`
    out += `   - 출원번호: ${h.applicationNumber} (${fmtDate(h.applicationDate)})\n`
    if (h.registrationNumber) out += `   - 등록번호: ${h.registrationNumber} (${fmtDate(h.registrationDate)})\n`
    if (h.classificationCode) out += `   - 상품류: ${h.classificationCode}\n`
    if (h.rightHolder) out += `   - 권리자: ${h.rightHolder}\n`
    if (h.drawing) out += `   - 견본: ${h.drawing}\n`
    out += "\n"
  })
  return out
}

/** 디자인 검색 결과 포맷팅 */
export function formatDesignResult(
  query: string,
  total: number,
  hits: DesignHit[]
): string {
  const t = Math.max(total, hits.length)
  let out = `🎨 디자인검색 "${query}" — 총 ${t.toLocaleString()}건`
  if (hits.length < t) out += ` (상위 ${hits.length}건 표시)`
  out += "\n\n"
  hits.forEach((h, i) => {
    out += `${i + 1}. ${statusMark(h.applicationStatus)} ${h.articleName || "(물품명없음)"}`
    if (h.applicationStatus) out += `  [${h.applicationStatus}]`
    out += "\n"
    if (h.applicant) out += `   - 출원인: ${h.applicant}\n`
    out += `   - 출원번호: ${h.applicationNumber} (${fmtDate(h.applicationDate)})\n`
    if (h.registrationNumber) out += `   - 등록번호: ${h.registrationNumber} (${fmtDate(h.registrationDate)})\n`
    if (h.designMainClassification) out += `   - 디자인분류: ${h.designMainClassification}\n`
    if (h.imagePath) out += `   - 도면: ${h.imagePath}\n`
    out += "\n"
  })
  return out
}

/** 서지상세 포맷팅 */
export function formatDetail(d: PatentDetail): string {
  let s = `📄 ${d.inventionTitle}`
  if (d.inventionTitleEng) s += ` / ${d.inventionTitleEng}`
  s += "\n\n"
  s += `- 출원번호: ${d.applicationNumber} (${d.applicationDate})\n`
  if (d.openNumber.trim()) s += `- 공개번호: ${d.openNumber} (${d.openDate})\n`
  if (d.publicationNumber.trim()) s += `- 공고번호: ${d.publicationNumber} (${d.publicationDate})\n`
  if (d.registerNumber.trim()) s += `- 등록번호: ${d.registerNumber} (${d.registerDate})\n`
  s += `- 등록상태: ${d.registerStatus}\n`
  if (d.finalDisposal) s += `- 최종처분: ${d.finalDisposal}\n`
  if (d.claimCount) s += `- 청구항수: ${d.claimCount}\n`
  if (d.examinerName) s += `- 심사관: ${d.examinerName}\n`
  if (d.originalApplicationKind) s += `- 출원종류: ${d.originalApplicationKind}\n`
  if (d.applicants.length) s += `- 출원인: ${d.applicants.join(", ")}\n`
  if (d.inventors.length) s += `- 발명자: ${d.inventors.join(", ")}\n`
  if (d.agents.length) s += `- 대리인: ${d.agents.join(", ")}\n`
  if (d.priorityList.length) s += `- 우선권: ${d.priorityList.join(", ")}\n`
  if (d.ipcList.length) s += `- IPC: ${d.ipcList.join(", ")}\n`
  return s
}
