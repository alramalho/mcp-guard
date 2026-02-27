# mcp-guard

A simple HTTP proxy that gates MCP servers with block rules.

No SDKs. No dashboards. Just a JSON config and a toggle command.

```
Client (Claude, Cursor, etc.)
    ↕ http
mcp-guard (localhost proxy)
    ↕ http
Upstream MCP server (supabase, postgres, etc.)
```

## Quick Start

### 1. Install

```bash
npm install -g @alramalho/mcp-guard
```

Or from source:

```bash
git clone https://github.com/alramalho/mcp-guard
cd mcp-guard
pnpm install && pnpm build && npm link --force
```

### 2. Create `.mcp-guard.json`

In your project root (or `~/.mcp-guard.json` globally). Config is auto-discovered by walking up from cwd.

```json
{
  "port": 6427,
  "servers": {
    "supabase_production": {
      "url": "https://mcp.supabase.com/mcp?project_ref=xxx&read_only=true",
      "block": ["DELETE", "UPDATE", "DROP", "TRUNCATE", "ALTER", "INSERT"],
      "blockMessage": "Destructive SQL operations are not allowed in production"
    }
  }
}
```

### 3. Update your `mcp.json`

Replace the direct upstream URL with the mcp-guard proxy:

```json
{
  "mcpServers": {
    "supabase_production": {
      "type": "http",
      "url": "http://localhost:6427/supabase_production"
    }
  }
}
```

### 4. Toggle on/off

```bash
$ mcp-guard
MCP Guard on → http://localhost:6427

$ mcp-guard
MCP Guard off
```

### Debug mode

Run in foreground to see all tool calls and block decisions live:

```bash
$ mcp-guard -d
```

## Config

`.mcp-guard.json` (auto-discovered from cwd up, or `~/.mcp-guard.json`, or `--config <path>`):

| Field     | Type     | Default | Description                        |
| --------- | -------- | ------- | ---------------------------------- |
| `port`    | `number` | `6427`  | Port for the local HTTP proxy      |
| `servers` | `object` | —       | Map of gate name → server config   |

Each server:

| Field          | Type       | Description                                        |
| -------------- | ---------- | -------------------------------------------------- |
| `url`          | `string`   | Upstream MCP server URL                            |
| `enabled`      | `boolean`  | Set to `false` to passthrough without blocking     |
| `block`        | `string[]` | Patterns to block (case-insensitive substring match) |
| `blockMessage` | `string`   | Error message returned when blocked                |

## How It Works

1. `mcp-guard` starts a local HTTP server
2. When a client connects to `http://localhost:PORT/<gate_name>`, it connects to the upstream MCP server
3. It discovers all upstream tools and re-exposes them
4. On each tool call, all argument values are checked against block patterns
5. If any pattern matches → error returned, call never reaches upstream
6. If no match → call is forwarded to upstream as-is

## License

MIT
