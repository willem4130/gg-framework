export interface MCPServerConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}
