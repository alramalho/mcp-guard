import http from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { shouldBlock } from "./rules.js";
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
function log(msg) {
    process.stderr.write(`${msg}\n`);
}
const sessions = new Map();
const gates = new Map();
async function connectUpstream(name, config) {
    const transport = new StreamableHTTPClientTransport(new URL(config.url));
    const client = new Client({ name: `mcp-guard-${name}`, version: "0.1.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    log(`${green("connected")} ${cyan(name)} ${dim(`(${tools.length} tools)`)}`);
    return { upstream: client, tools };
}
async function getGate(name, config) {
    if (gates.has(name))
        return gates.get(name);
    const gate = await connectUpstream(name, config);
    gates.set(name, gate);
    return gate;
}
function createGatedServer(gate, gateConfig) {
    const server = new McpServer({ name: "mcp-guard", version: "0.1.0" });
    for (const tool of gate.tools) {
        server.registerTool(tool.name, {
            title: tool.name,
            description: tool.description ?? "",
            inputSchema: z.object({}).passthrough(),
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
        }, async (args) => {
            log(`${dim(`[${tool.name}]`)} ${dim(JSON.stringify(args).slice(0, 200))}`);
            if (gateConfig.enabled !== false && gateConfig.block?.length) {
                const result = shouldBlock(args, gateConfig.block);
                if (result.blocked) {
                    const msg = gateConfig.blockMessage ?? `Blocked: matched pattern "${result.pattern}"`;
                    log(`${red("blocked")} ${cyan(tool.name)} ${dim(msg)}`);
                    return {
                        content: [{ type: "text", text: `⛔ ${msg}` }],
                        isError: true,
                    };
                }
            }
            try {
                const result = await gate.upstream.callTool({
                    name: tool.name,
                    arguments: args,
                });
                return {
                    content: (result.content ?? []),
                    isError: (result.isError ?? false),
                };
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log(`${red("error")} ${cyan(tool.name)} ${dim(message)}`);
                return {
                    content: [{ type: "text", text: `Upstream error: ${message}` }],
                    isError: true,
                };
            }
        });
    }
    return server;
}
async function handleRequest(req, res, config) {
    const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
    const gateName = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    log(`${dim(`${req.method} /${gateName}`)}`);
    if (!gateName) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", gates: Object.keys(config.servers) }));
        return;
    }
    if (!config.servers[gateName]) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            error: `Unknown gate: "${gateName}"`,
            available: Object.keys(config.servers),
        }));
        return;
    }
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (req.method === "DELETE") {
            await session.transport.handleRequest(req, res);
            sessions.delete(sessionId);
            return;
        }
        const body = req.method === "POST" ? await readBody(req) : undefined;
        await session.transport.handleRequest(req, res, body);
        return;
    }
    // Unknown session ID → tell client to re-initialize
    if (sessionId) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }));
        return;
    }
    if (req.method !== "POST") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "New sessions must start with POST" }));
        return;
    }
    const gateConfig = config.servers[gateName];
    let gate;
    try {
        gate = await getGate(gateName, gateConfig);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`${red("upstream failed")} ${cyan(gateName)} ${dim(msg)}`);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Failed to connect to upstream: ${msg}` }));
        return;
    }
    const server = createGatedServer(gate, gateConfig);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
            sessions.set(sid, { gateName, server, transport });
        },
    });
    await server.connect(transport);
    const body = await readBody(req);
    await transport.handleRequest(req, res, body);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : undefined);
            }
            catch (e) {
                reject(e);
            }
        });
        req.on("error", reject);
    });
}
export async function startServer(config) {
    const httpServer = http.createServer(async (req, res) => {
        try {
            await handleRequest(req, res, config);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`${red("error")} ${dim(msg)}`);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: msg }));
            }
        }
    });
    httpServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            log(`${red("port")} ${dim(`${config.port} already in use`)}`);
            process.exit(1);
        }
        throw err;
    });
    httpServer.listen(config.port, () => {
        log(`${green("listening")} ${dim(`http://localhost:${config.port}`)}`);
        for (const [name, s] of Object.entries(config.servers)) {
            log(`  ${cyan(name)} ${dim("→")} ${dim(s.url)}`);
        }
    });
    process.on("SIGTERM", async () => {
        for (const [, gate] of gates) {
            await gate.upstream.close();
        }
        for (const [, session] of sessions) {
            await session.server.close();
        }
        httpServer.close();
        process.exit(0);
    });
    process.on("SIGINT", async () => {
        httpServer.close();
        process.exit(0);
    });
}
//# sourceMappingURL=server.js.map