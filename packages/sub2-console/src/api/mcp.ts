/**
 * MCP API endpoints
 * Manages user MCP (Model Context Protocol) OAuth grants.
 * 上游 v0.2.20 新增；MCP 默认关闭（仅当部署配置 MCP_PUBLIC_URL 时启用）。
 */

import { apiClient } from './client'
import type {
  MCPGrant,
  MCPAuthorization,
  MCPConsent,
  MCPAuthorizationDecision
} from '@/types'

// 与上游一致：以上类型由 @/types 提供，此处再导出以保持 `from '@/api/mcp'` 引用路径可用。
export type {
  MCPAccessScope,
  MCPGrant,
  MCPAuthorization,
  MCPConsent,
  MCPAuthorizationDecision
} from '@/types'

export const mcpAPI = {
  async getConnectionConfig(): Promise<{ resource: string }> {
    const { data } = await apiClient.get<{ resource: string }>('/user/mcp/config')
    return data
  },
  async listGrants(): Promise<MCPGrant[]> {
    const { data } = await apiClient.get<MCPGrant[]>('/user/mcp/grants')
    return data
  },
  async revokeGrant(id: string): Promise<void> {
    await apiClient.delete(`/user/mcp/grants/${encodeURIComponent(id)}`)
  },
  async previewAuthorization(authorization: MCPAuthorization): Promise<MCPConsent> {
    const { data } = await apiClient.get<MCPConsent>('/user/mcp/authorize', { params: authorization })
    return data
  },
  async authorize(input: MCPAuthorizationDecision): Promise<{ redirect_url: string }> {
    const { data } = await apiClient.post<{ redirect_url: string }>('/user/mcp/authorize', input)
    return data
  }
}

export default mcpAPI
