/** 응답 크기 상한 (50KB) */
export const MAX_RESPONSE_SIZE = 50000

/**
 * 응답을 상한 이내로 자른다. 모든 포맷터는 항목을 `\n\n` 으로 구분하므로,
 * 상한 직전의 항목 경계(`\n\n`)에서 잘라 항목이 중간에 끊겨 LLM 이 손상된
 * 레코드를 사실로 오인하는 것을 방지한다. 경계를 못 찾으면(단일 거대 항목)
 * 최소 절반은 보존하기 위해 하드 절단으로 폴백한다.
 */
export function truncateResponse(text: string, maxSize = MAX_RESPONSE_SIZE): string {
  if (text.length <= maxSize) return text
  const slice = text.slice(0, maxSize)
  const lastBreak = slice.lastIndexOf("\n\n")
  const cut = lastBreak > maxSize / 2 ? slice.slice(0, lastBreak) : slice
  return (
    cut +
    `\n\n⚠️ 응답이 길어 일부 항목만 표시했습니다(크기 ${maxSize.toLocaleString()}자 제한). ` +
    `더 좁은 검색어나 numOfRows 축소를 권장합니다.`
  )
}
