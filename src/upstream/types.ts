export interface ManagedUpstreamConfig {
  enabled: boolean;
  pythonPath: string;
  workingDirectory: string;
  appFile: string;
  host: string;
  port: number;
  startTimeoutMs: number;
  healthPath: string;
  requestTimeoutMs: number;
}

export interface ManagedUpstreamHandle {
  baseUrl: string;
  managed: boolean;
  pid?: number;
  stop(): Promise<void>;
}
