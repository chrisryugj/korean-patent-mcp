/**
 * API 키 마스킹 — 에러 메시지/로그에 키가 노출되는 것을 방지
 */
export function maskSensitiveUrl(url: string): string {
  if (!url) return url
  return url.replace(
    /([?&](?:accessKey|ServiceKey|serviceKey|apikey|apiKey|api_key|key)=)[^&]+/g,
    "$1***"
  )
}

export interface FetchWithRetryOptions extends RequestInit {
  timeout?: number
  retries?: number
  retryDelay?: number
  retryOn?: number[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRetryDelay(
  response: Response | null,
  retryDelay: number,
  attempt: number
): number {
  if (response) {
    const retryAfter = response.headers.get("Retry-After")
    if (retryAfter && !isNaN(Number(retryAfter))) {
      return Number(retryAfter) * 1000
    }
  }
  const base = retryDelay * Math.pow(2, attempt)
  return base + Math.random() * base * 0.5
}

/**
 * Fetch with timeout + 재시도 + API 키 마스킹.
 * KIPRIS 는 일시적으로 빈 본문/5xx 를 반환하는 경우가 있어 방어한다.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeout = 30000,
    retries = 3,
    retryDelay = 1000,
    retryOn = [429, 500, 502, 503, 504],
    ...fetchOptions
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const headers = new Headers(fetchOptions.headers)
    if (!headers.has("user-agent")) {
      headers.set(
        "user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      )
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (response.ok || !retryOn.includes(response.status)) {
        return response
      }

      if (attempt < retries) {
        await sleep(getRetryDelay(response, retryDelay, attempt))
        continue
      }
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error) {
        lastError =
          error.name === "AbortError"
            ? new Error(`요청 타임아웃(${timeout}ms) - ${maskSensitiveUrl(url)}`)
            : new Error(maskSensitiveUrl(error.message))
      }
      if (attempt < retries) {
        await sleep(getRetryDelay(null, retryDelay, attempt))
        continue
      }
    }
  }

  throw lastError || new Error("재시도 소진")
}
