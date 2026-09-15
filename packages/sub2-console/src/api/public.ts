import { buildApiUrl, buildGatewayUrl } from './url';
import type { PublicSettings } from '@/types';
import type { ModelPlazaResponse } from './modelPlaza';

export interface UsageTotals {
  requests?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number;
  cache_creation_tokens?: number; cache_read_tokens?: number; actual_cost?: number;
}
export interface KeyUsageResult {
  mode?: string; status?: string; isValid?: boolean; planName?: string;
  balance?: number; remaining?: number; expires_at?: string; days_until_expiry?: number;
  quota?: { limit: number; used: number; remaining: number };
  rate_limits?: { window: string; limit: number; used: number; reset_at?: string }[];
  subscription?: { daily_usage_usd?: number; daily_limit_usd?: number; weekly_usage_usd?: number;
    weekly_limit_usd?: number; monthly_usage_usd?: number; monthly_limit_usd?: number; expires_at?: string };
  usage?: { today?: UsageTotals; total?: UsageTotals; average_duration_ms?: number };
  daily_usage?: { date: string; requests: number; input_tokens: number; output_tokens: number;
    cache_read_tokens: number; cache_write_tokens: number; cost: number; actual_cost?: number }[];
  model_stats?: { model: string; requests: number; input_tokens?: number; output_tokens?: number; cache_creation_tokens?: number; cache_read_tokens?: number; total_tokens?: number; cost?: number; actual_cost?: number }[];
}

// No account interceptor, cookie, automatic refresh, redirect or credential storage.
// In particular, a saved login token must never overwrite the submitted API key.
async function request(url: string, signal?: AbortSignal, token?: string, raw = false) {
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? '访问被拒绝，请检查密钥或登录权限。' : response.status === 404
      ? '内容不存在或此功能尚未开放。' : `读取失败（HTTP ${response.status}），请重试。`);
  if (raw) return response.text();
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('服务返回了非 JSON 内容。');
  const body = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('服务响应格式无效。');
  if ('code' in body) {
    if (body.code !== 0 || body.data == null) throw new Error('服务未能完成读取，请重试。');
    return body.data;
  }
  return body;
}
export function getPublicSettings(signal?: AbortSignal): Promise<PublicSettings> {
  return request(buildApiUrl('/settings/public'), signal);
}
export function getPublicModels(signal?: AbortSignal, token?: string): Promise<ModelPlazaResponse> {
  return request(buildApiUrl('/model-plaza'), signal, token);
}
export function getCustomPage(slug: string, signal?: AbortSignal, token?: string): Promise<string> {
  if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return Promise.reject(new Error('页面标识无效。'));
  return request(buildApiUrl(`/pages/${encodeURIComponent(slug)}`), signal, token, true);
}
export async function queryKeyUsage(key: string, params: { start_date: string; end_date: string; days: number; timezone: string }, signal?: AbortSignal): Promise<KeyUsageResult> {
  if (!key.trim() || /[\r\n]/.test(key)) throw new Error('请输入有效的 API 密钥。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(params.end_date)
    || [params.start_date, params.end_date].some(value => { const date = new Date(value); return !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value; })
    || params.start_date > params.end_date || ![7, 30, 90].includes(params.days)) throw new Error('请选择有效的日期范围。');
  const search = new URLSearchParams({ ...params, days: String(params.days) });
  return request(`${buildGatewayUrl('/v1/usage')}?${search}`, signal, key.trim());
}
