#!/usr/bin/env node
import "dotenv/config"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { KiprisApiClient } from "./lib/api-client.js"
import { registerTools } from "./tool-registry.js"
import { startHTTPServer } from "./server/http-server.js"
import { VERSION } from "./version.js"

const apiClient = new KiprisApiClient({ apiKey: process.env.KIPRIS_API_KEY || "" })

function createServer(): Server {
  const s = new Server(
    { name: "korean-patent", version: VERSION },
    { capabilities: { tools: {} } }
  )
  registerTools(s, apiClient)
  return s
}

async function main() {
  const args = process.argv.slice(2)
  const modeIdx = args.indexOf("--mode")
  const mode = modeIdx !== -1 ? args[modeIdx + 1] : "stdio"
  const portIdx = args.indexOf("--port")
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 8000

  if (mode === "http" || mode === "sse") {
    await startHTTPServer(createServer, port)
  } else {
    // STDIO: stdout 은 JSON-RPC 전용 — 로그를 stderr 로 우회
    const toStderr = (...a: unknown[]) =>
      process.stderr.write(a.map(String).join(" ") + "\n")
    console.log = console.warn = console.info = console.debug = toStderr

    const server = createServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}

main().catch((e) => {
  process.stderr.write(`Server error: ${e}\n`)
  process.exit(1)
})
