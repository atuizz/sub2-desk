import { apiClient } from '../client'

export type PromptAuditMode = 'off' | 'async_audit' | 'blocking'
export type PromptDecision = 'pass' | 'flag' | 'critical'
export type PromptRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface PromptAuditEndpoint {
  id: string
  name: string
  protocol: 'openai_compatible'
  base_url: string
  model: string
  timeout_ms: number
  input_limit: number
  enabled: boolean
  has_token: boolean
  token_status: 'configured' | 'missing' | 'invalid' | string
}

export interface PromptAuditEndpointDraft extends PromptAuditEndpoint {
  token: string
  clear_token: boolean
}

export interface PromptAuditConfig {
  enabled: boolean
  blocking_enabled: boolean
  blocking_latest_turn_only: boolean
  store_pass_events: boolean
  effective_mode: PromptAuditMode
  strategy: 'priority'
  worker_count: number
  queue_capacity: number
  scanners: string[]
  all_groups: boolean
  group_ids: number[]
  endpoints: PromptAuditEndpoint[]
  config_version: number
  updated_at: string
  updated_by: number
  change_summary: string
}

export interface PromptAuditUpdateRequest {
  expected_config_version: number
  enabled: boolean
  blocking_enabled: boolean
  blocking_latest_turn_only: boolean
  store_pass_events: boolean
  strategy: 'priority'
  worker_count: number
  queue_capacity: number
  scanners: string[]
  all_groups: boolean
  group_ids: number[]
  endpoints: Array<{
    id: string
    name: string
    protocol: 'openai_compatible'
    base_url: string
    model: string
    token?: string
    clear_token: boolean
    timeout_ms: number
    input_limit: number
    enabled: boolean
  }>
}

export interface PromptProbeResult {
  ok: boolean
  status: string
  error_code?: string
  message: string
  latency_ms: number
  http_status: number
  retryable: boolean
  checked_at: string
  token_applied: boolean
}

export interface PromptAuditEvent {
  id: number
  created_at: string
  request_id: string
  user_id: number
  user_email: string
  api_key_id: number
  group_id: number
  group_name: string
  ingress: string
  model: string
  decision: PromptDecision
  risk_level: PromptRiskLevel
  prompt_preview: string
  prompt_sha256: string
  full_prompt?: string
  latency_ms: number
  categories?: string[]
}

export interface PromptEventFilters {
  decision?: string
  risk_level?: string
  ingress?: string
  group_id?: number
  user_id?: number
  api_key_id?: number
  request_id?: string
  prompt_sha256?: string
  keyword?: string
  start_time?: string
  end_time?: string
}

export interface PromptEventPage {
  items: PromptAuditEvent[]
  total: number
  page: number
  page_size: number
}

const basePath = '/admin/prompt-audit'

export async function getConfig(): Promise<PromptAuditConfig> {
  const { data } = await apiClient.get<any>(`${basePath}/config`)
  return data.data || data
}

export async function updateConfig(payload: PromptAuditUpdateRequest): Promise<PromptAuditConfig> {
  const { data } = await apiClient.put<any>(`${basePath}/config`, payload)
  return data.data || data
}

export async function probeEndpoint(endpoint: PromptAuditEndpointDraft): Promise<PromptProbeResult> {
  const { data } = await apiClient.post<any>(`${basePath}/endpoints/probe`, {
    endpoint: {
      id: endpoint.id,
      name: endpoint.name,
      protocol: 'openai_compatible',
      base_url: endpoint.base_url,
      model: endpoint.model,
      token: endpoint.token || undefined,
      timeout_ms: endpoint.timeout_ms,
      input_limit: endpoint.input_limit,
      enabled: endpoint.enabled,
    },
  })
  return data.data || data
}

export async function listEvents(
  filters: PromptEventFilters,
  page: number,
  pageSize: number,
): Promise<PromptEventPage> {
  const { data } = await apiClient.get<any>(`${basePath}/events`, {
    params: { page, page_size: pageSize, ...filters },
  })
  return data.data || data
}

export async function getEvent(id: number): Promise<PromptAuditEvent> {
  const { data } = await apiClient.get<any>(`${basePath}/events/${id}`)
  return data.data || data
}

export async function deleteEvent(id: number): Promise<{ deleted: number }> {
  const { data } = await apiClient.delete<any>(`${basePath}/events/${id}`)
  return data.data || data
}

export async function batchDeleteEvents(ids: number[]): Promise<{ deleted: number }> {
  const { data } = await apiClient.post<any>(`${basePath}/events/batch-delete`, { ids })
  return data.data || data
}

export const promptAuditAPI = {
  getConfig,
  updateConfig,
  probeEndpoint,
  listEvents,
  getEvent,
  deleteEvent,
  batchDeleteEvents
}

export default promptAuditAPI
