/**
 * User Payment API endpoints
 * Handles payment operations for regular users
 */

import { apiClient } from './client'
import axios, { type AxiosResponse } from 'axios'
import { buildApiUrl } from './url'
import type {
  PaymentConfig,
  SubscriptionPlan,
  MethodLimitsResponse,
  CheckoutInfoResponse,
  CreateOrderRequest,
  CreateOrderResult,
  PaymentOrder
} from '@/types/payment'
import type { BasePaginationResponse } from '@/types'

export interface PublicOrderVerifyResult {
  out_trade_no: string
  status: string
  paid: boolean
  created_at: string
  expires_at: string
}

// Public return links must not trigger the authenticated client's 401 logout/redirect.
// These two endpoints authenticate with the order reference/signature, not account tokens.
async function publicPaymentPost<T>(path: string, body: Record<string, string>, signal?: AbortSignal): Promise<AxiosResponse<T>> {
  const response = await axios.post<T | { code: number; message?: string; data: T }>(buildApiUrl(path), body, { signal, timeout: 30000, withCredentials: false });
  const envelope = response.data;
  if (envelope && typeof envelope === 'object' && 'code' in envelope) {
    if (envelope.code !== 0) throw new Error(envelope.message || '支付结果查询失败');
    return { ...response, data: envelope.data };
  }
  return response as AxiosResponse<T>;
}

export const paymentAPI = {
  /** Get payment configuration (enabled types, limits, etc.) */
  getConfig() {
    return apiClient.get<PaymentConfig>('/payment/config')
  },

  /** Get available subscription plans */
  getPlans() {
    return apiClient.get<SubscriptionPlan[]>('/payment/plans')
  },

  /** Get all checkout page data in a single call */
  getCheckoutInfo() {
    return apiClient.get<CheckoutInfoResponse>('/payment/checkout-info')
  },

  /** Get payment method limits and fee rates */
  getLimits() {
    return apiClient.get<MethodLimitsResponse>('/payment/limits')
  },

  /** Create a new payment order */
  createOrder(data: CreateOrderRequest) {
    return apiClient.post<CreateOrderResult>('/payment/orders', data)
  },

  /** Get current user's orders */
  getMyOrders(params?: { page?: number; page_size?: number; status?: string }) {
    return apiClient.get<BasePaginationResponse<PaymentOrder>>('/payment/orders/my', { params })
  },

  /** Get a specific order by ID */
  getOrder(id: number, signal?: AbortSignal) {
    return apiClient.get<PaymentOrder>(`/payment/orders/${id}`, { signal })
  },

  /** Cancel a pending order */
  cancelOrder(id: number) {
    return apiClient.post(`/payment/orders/${id}/cancel`)
  },

  /** Verify order payment status with upstream provider */
  verifyOrder(outTradeNo: string, signal?: AbortSignal) {
    return apiClient.post<PaymentOrder>('/payment/orders/verify', { out_trade_no: outTradeNo }, { signal })
  },

  /** Legacy-compatible public order lookup by out_trade_no */
  verifyOrderPublic(outTradeNo: string, signal?: AbortSignal) {
    return publicPaymentPost<PublicOrderVerifyResult>('/payment/public/orders/verify', { out_trade_no: outTradeNo }, signal)
  },

  /** Resolve an order from a signed resume token without auth */
  resolveOrderPublicByResumeToken(resumeToken: string, signal?: AbortSignal) {
    return publicPaymentPost<PublicOrderVerifyResult>('/payment/public/orders/resolve', { resume_token: resumeToken }, signal)
  },

  /** Request a refund for a completed order */
  requestRefund(id: number, data: { reason: string }) {
    return apiClient.post(`/payment/orders/${id}/refund-request`, data)
  },

  /** Get provider instance IDs that allow user refund */
  getRefundEligibleProviders() {
    return apiClient.get<{ provider_instance_ids: string[] }>('/payment/orders/refund-eligible-providers')
  }
}
