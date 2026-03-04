import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata, OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const CALLBACK_PORT = 19284;
const CALLBACK_PATH = "/oauth/callback";

function storageDir(): string {
  const dir = path.join(os.homedir(), ".mcp-guard", "auth");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class McpGuardAuthProvider implements OAuthClientProvider {
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _clientInfo?: OAuthClientInformationMixed;
  private _gateName: string;
  private _pendingCode?: Promise<string>;
  private _resolvePendingCode?: (code: string) => void;

  constructor(gateName: string) {
    this._gateName = gateName;
    try {
      const data = fs.readFileSync(path.join(storageDir(), `${gateName}.tokens.json`), "utf-8");
      this._tokens = JSON.parse(data);
    } catch { /* no cached tokens */ }
    try {
      const data = fs.readFileSync(path.join(storageDir(), `${gateName}.client.json`), "utf-8");
      this._clientInfo = JSON.parse(data);
    } catch { /* no cached client info */ }
  }

  get redirectUrl(): string {
    return `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "mcp-guard",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return this._clientInfo;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    this._clientInfo = info;
    fs.writeFileSync(path.join(storageDir(), `${this._gateName}.client.json`), JSON.stringify(info, null, 2));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this._tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._tokens = tokens;
    fs.writeFileSync(path.join(storageDir(), `${this._gateName}.tokens.json`), JSON.stringify(tokens, null, 2));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${openCmd} "${authorizationUrl.toString()}"`);
    process.stderr.write(`\x1b[33mauth\x1b[0m opening browser for ${this._gateName}...\n`);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this._codeVerifier = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    return this._codeVerifier ?? "";
  }

  state(): string {
    return randomUUID();
  }

  waitForAuthCode(): Promise<string> {
    if (!this._pendingCode) {
      this._pendingCode = new Promise<string>((resolve, reject) => {
        this._resolvePendingCode = resolve;

        const server = http.createServer((req, res) => {
          const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
          if (url.pathname !== CALLBACK_PATH) {
            res.writeHead(404);
            res.end();
            return;
          }
          const code = url.searchParams.get("code");
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("<html><body><h2>Error: no code received</h2></body></html>");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authenticated! You can close this tab.</h2></body></html>");
          server.close();
          resolve(code);
        });

        server.listen(CALLBACK_PORT);

        setTimeout(() => {
          server.close();
          reject(new Error("OAuth callback timed out after 2 minutes"));
        }, 120_000);
      });
    }
    return this._pendingCode;
  }
}
