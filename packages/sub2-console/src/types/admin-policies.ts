import type { AdminGroup, CreateGroupRequest, UpdateGroupRequest } from './index'

export type { ModelAllowlist, CodexModelsManifestConfig as CodexManifestConfig } from './index'
export type PolicyGroup = AdminGroup
export type CreatePolicyGroup = CreateGroupRequest
export type UpdatePolicyGroup = UpdateGroupRequest

export interface AttributeDefinition {
  id: number; key: string; name: string; description: string
  type: 'text' | 'textarea' | 'number' | 'email' | 'url' | 'date' | 'select' | 'multi_select'
  options: { value: string; label: string }[]
  required: boolean; enabled: boolean; placeholder: string; display_order: number
  validation?: { min_length?: number; max_length?: number; min?: number; max?: number; pattern?: string; message?: string }
}
export interface AttributeValue { attribute_id: number; value: string }
export type AttributeDefinitionInput = Omit<AttributeDefinition, 'id'>
