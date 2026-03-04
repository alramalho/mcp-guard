export interface ServerConfig {
  url: string;
  enabled?: boolean;
  token?: string;
  block?: string[];
  blockMessage?: string;
}

export interface GuardConfig {
  port: number;
  servers: Record<string, ServerConfig>;
}
