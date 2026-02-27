#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { startServer } from "./server.js";
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const PID_FILE = join(homedir(), ".mcp-guard.pid");
const CONFIG_NAME = ".mcp-guard.json";
const GLOBAL_CONFIG = join(homedir(), CONFIG_NAME);
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
async function getRunningPid(port) {
    if (!existsSync(PID_FILE))
        return undefined;
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) {
        unlinkSync(PID_FILE);
        return undefined;
    }
    if (!isProcessRunning(pid)) {
        unlinkSync(PID_FILE);
        return undefined;
    }
    // verify the server actually responds
    try {
        const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
        if (res.ok)
            return pid;
    }
    catch { }
    // process exists but server isn't responding — stale
    unlinkSync(PID_FILE);
    return undefined;
}
function turnOff(pid) {
    process.kill(pid, "SIGTERM");
    unlinkSync(PID_FILE);
    console.log(red("MCP Guard off"));
}
function turnOn(configPath, port) {
    const child = spawn(process.execPath, [process.argv[1], "--serve", "--config", configPath], {
        detached: true,
        stdio: "ignore",
    });
    child.unref();
    writeFileSync(PID_FILE, String(child.pid));
    console.log(green("MCP Guard on") + dim(` → http://localhost:${port}`));
}
function findConfigUp() {
    let dir = resolve(".");
    const root = homedir();
    while (true) {
        const candidate = join(dir, CONFIG_NAME);
        if (existsSync(candidate))
            return candidate;
        const parent = dirname(dir);
        if (parent === dir || dir === root)
            break;
        dir = parent;
    }
    if (existsSync(GLOBAL_CONFIG))
        return GLOBAL_CONFIG;
    return undefined;
}
function resolveConfigPath(explicit) {
    if (explicit)
        return resolve(explicit);
    const found = findConfigUp();
    if (found)
        return found;
    console.log(red("No .mcp-guard.json found") + dim(` (searched up from ${resolve(".")})`));
    process.exit(1);
}
function loadConfig(configPath) {
    const resolved = resolve(configPath);
    if (!existsSync(resolved)) {
        console.log(red(`Config not found: ${resolved}`));
        process.exit(1);
    }
    const raw = readFileSync(resolved, "utf-8");
    const config = JSON.parse(raw);
    if (!config.port)
        config.port = 6427;
    if (!config.servers || Object.keys(config.servers).length === 0) {
        console.log(red("Config must have at least one server"));
        process.exit(1);
    }
    return config;
}
function parseArgs(argv) {
    let configPath;
    let serve = false;
    let debug = false;
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--serve") {
            serve = true;
        }
        else if (arg === "-d" || arg === "--debug") {
            debug = true;
        }
        else if (arg === "--config" || arg === "-c") {
            i++;
            if (i >= argv.length) {
                console.log(red("--config requires a path"));
                process.exit(1);
            }
            configPath = argv[i];
        }
        else if (arg === "--help" || arg === "-h") {
            console.log(`
${green("mcp-guard")} — gate your MCP servers

${yellow("Usage:")}
  mcp-guard              Toggle proxy on/off
  mcp-guard -d           Run in foreground (debug)
  mcp-guard -c <path>    Use specific config

Config is auto-discovered by walking up from cwd, or from ~/.mcp-guard.json.

${yellow("Example config:")}
  {
    "port": 6427,
    "servers": {
      "supabase_prod": {
        "url": "https://mcp.supabase.com/mcp?project_ref=xxx",
        "block": ["DELETE", "DROP", "UPDATE"],
        "blockMessage": "Blocked in production"
      }
    }
  }

${yellow("Then in mcp.json:")}
  "supabase_prod": { "type": "http", "url": "http://localhost:6427/supabase_prod" }
`);
            process.exit(0);
        }
    }
    return { configPath, serve, debug };
}
async function main() {
    const { configPath, serve, debug } = parseArgs(process.argv);
    // Internal: run the HTTP server (called by the background process)
    if (serve) {
        const config = loadConfig(configPath);
        await startServer(config);
        return;
    }
    const resolvedConfig = resolveConfigPath(configPath);
    const config = loadConfig(resolvedConfig);
    // Debug mode: run in foreground
    if (debug) {
        console.log(green("MCP Guard") + dim(` → http://localhost:${config.port} (debug)`));
        await startServer(config);
        return;
    }
    // Toggle: if running → kill. If not running → start.
    const pid = await getRunningPid(config.port);
    if (pid) {
        turnOff(pid);
        return;
    }
    turnOn(resolvedConfig, config.port);
    console.log(dim(`config: ${resolvedConfig}`));
    for (const [name, s] of Object.entries(config.servers)) {
        const status = s.enabled === false ? yellow("(disabled)") : "";
        console.log(`  ${cyan(name)} ${dim("→")} ${dim(s.url)} ${status}`);
    }
}
main().catch((err) => {
    console.log(red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
});
//# sourceMappingURL=index.js.map