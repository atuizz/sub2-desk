/**
 * 格式化工具函数 - 严格遵循 Sub2API 官方规范
 */

export function formatCurrency(amount: number | null | undefined, currency: string = 'USD'): string {
  if (amount === null || amount === undefined) return '$0.00'
  const fractionDigits = amount > 0 && amount < 0.01 ? 6 : 2
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(amount)
}

export function formatBalance(balance: number | null | undefined): string {
  if (balance === null || balance === undefined) return '0.00'
  return balance.toFixed(2)
}

export function formatCost(amount: number | null | undefined, fractionDigits: number = 4): string {
  if (amount === null || amount === undefined) return '0.0000'
  return amount.toFixed(fractionDigits)
}

export function formatCostFixed(amount: number | null | undefined, fractionDigits: number = 4): string {
  if (amount === null || amount === undefined) return '0.0000'
  return amount.toFixed(fractionDigits)
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '0'
  return num.toLocaleString()
}

export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) return '0'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
  return tokens.toString()
}

export function formatTokensK(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
  return tokens.toString()
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms === 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export function formatDateLocalInput(date: Date): string {
  if (isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeReasoningEffortKey(effort: string | null | undefined): string {
  return (effort ?? '').toString().trim().toLowerCase().replace(/[-_\s]/g, '')
}

export function formatReasoningEffort(effort: string | null | undefined): string {
  const raw = (effort ?? '').toString().trim()
  if (!raw) return '-'

  const normalized = normalizeReasoningEffortKey(raw)
  switch (normalized) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    case 'xhigh':
    case 'extrahigh':
      return 'XHigh'
    case 'max':
      return 'Max'
    case 'none':
    case 'minimal':
      return '-'
    default:
      return raw.length > 1 ? raw[0].toUpperCase() + raw.slice(1) : raw.toUpperCase()
  }
}
