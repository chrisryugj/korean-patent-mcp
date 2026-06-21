import { AsyncLocalStorage } from "node:async_hooks"

export interface RequestContext {
  apiKey?: string
}

/** HTTP stateless 모드에서 요청별 API 키를 주입하기 위한 컨텍스트 */
export const requestContext = new AsyncLocalStorage<RequestContext>()
