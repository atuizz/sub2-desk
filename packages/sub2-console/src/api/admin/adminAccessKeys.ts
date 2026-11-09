/**
 * Admin Access Keys API endpoints
 * Fine-grained admin API keys (upstream v0.2.19新增).
 */

import { apiClient } from '../client'
import type {
  AdminAccessPermission,
  AdminKey,
  AdminKeyInput
} from '@/types'

// 与上游一致：以上类型由 @/types 提供（Permission 在 desk types 中名为
// AdminAccessPermission），此处再导出以保持 `from '@/api/admin/adminAccessKeys'`
// 引用路径与上游导出名一致。
export type {
  AccessPolicy,
  AccessRule,
  AdminKey,
  AdminKeyInput
} from '@/types'
export type Permission = AdminAccessPermission

const base = '/admin/settings/admin-api-keys'

export async function list() { return (await apiClient.get<{ items: AdminKey[]; permissions: Permission[] }>(base)).data }
export async function create(input: AdminKeyInput) { return (await apiClient.post<{ key: string; item: AdminKey }>(base, input)).data }
export async function update(id: string, input: AdminKeyInput) { return (await apiClient.put<AdminKey>(`${base}/${encodeURIComponent(id)}`, input)).data }
export async function rotate(id: string) { return (await apiClient.post<{ key: string; item: AdminKey }>(`${base}/${encodeURIComponent(id)}/rotate`)).data }
export async function revoke(id: string) { return (await apiClient.delete<{ message: string }>(`${base}/${encodeURIComponent(id)}`)).data }
export async function deleteRecord(id: string) { return (await apiClient.delete<{ message: string }>(`${base}/${encodeURIComponent(id)}/record`)).data }

export const adminAccessKeysAPI = {
  list,
  create,
  update,
  rotate,
  revoke,
  deleteRecord
}

export default adminAccessKeysAPI
