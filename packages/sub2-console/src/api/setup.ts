import { buildGatewayUrl } from './url';
export interface SetupStatus { needs_setup: boolean; step: string }
export interface DatabaseConfig { host: string; port: number; user: string; password: string; dbname: string; sslmode: string }
export interface RedisConfig { host: string; port: number; username: string; password: string; db: number; enable_tls: boolean }
export interface InstallRequest {
  database: DatabaseConfig; redis: RedisConfig;
  admin: { email: string; password: string };
  server: { host: string; port: number; mode: string };
}
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30000);
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) timeout.abort();
  try {
  const response = await fetch(buildGatewayUrl(path), {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: timeout.signal,
  });
  const envelope = await response.json();
  if (!response.ok || (envelope.code !== undefined && envelope.code !== 0)) throw new Error(envelope.message || envelope.detail || '安装服务请求失败');
  return envelope.data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function getSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  const data = await request('/setup/status', undefined, signal);
  if (!data || typeof data.needs_setup !== 'boolean') throw new Error('安装状态无效，请检查后端连接');
  return data;
}
export const testDatabase = (body: DatabaseConfig, signal?: AbortSignal) => request('/setup/test-db', body, signal);
export const testRedis = (body: RedisConfig, signal?: AbortSignal) => request('/setup/test-redis', body, signal);
export async function install(body: InstallRequest, signal?: AbortSignal): Promise<{message: string; restart: boolean}> {
  const data = await request('/setup/install', body, signal);
  if (!data || typeof data.restart !== 'boolean') throw new Error('安装响应不完整，请先检查服务状态');
  return data;
}
