import { reactive } from 'vue'

export type IpGeoStatus = 'idle' | 'loading' | 'success' | 'error' | 'private'

export interface IpGeoDetail {
  countryCode?: string
  region?: string
  city?: string
  organization?: string
  timezone?: string
  accuracy?: number
  latitude?: string
  longitude?: string
}

export interface IpGeoEntry {
  status: IpGeoStatus
  label?: string
  detail?: IpGeoDetail
  fetchedAt?: number
}

const IDLE_ENTRY: IpGeoEntry = { status: 'idle' }
const CACHE_STORAGE_KEY = 'sub2api:ip-geo-cache:v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const BATCH_CHUNK_SIZE = 50
const GEO_SINGLE_URL = 'https://get.geojs.io/v1/ip/geo'
const GEO_BATCH_URL = 'https://get.geojs.io/v1/ip/geo.json'

interface StoredEntry {
  label: string
  detail?: IpGeoDetail
  fetchedAt: number
}

const cache = reactive(new Map<string, IpGeoEntry>())

function isFreshSuccess(entry: IpGeoEntry | undefined): entry is IpGeoEntry & { status: 'success'; fetchedAt: number } {
  return entry?.status === 'success' && typeof entry.fetchedAt === 'number' && Date.now() - entry.fetchedAt <= CACHE_TTL_MS
}

function getFreshEntry(ip: string): IpGeoEntry | undefined {
  const entry = cache.get(ip)
  if (entry?.status === 'success' && !isFreshSuccess(entry)) {
    cache.delete(ip)
    persistToStorage()
    return undefined
  }
  return entry
}

export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  const clean = ip.toLowerCase().split('%')[0]
  if (clean === '::1' || clean === '::') return true
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true
  if (clean.startsWith('fe80:')) return true
  return false
}

export function formatGeoLabel(countryCode?: string, region?: string, city?: string): string {
  const parts = [countryCode, region, city].filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  return parts.join(' · ')
}

function persistToStorage() {
  if (typeof window === 'undefined') return
  try {
    const obj: Record<string, StoredEntry> = {}
    for (const [ip, entry] of cache.entries()) {
      if (entry.status === 'success' && entry.label && entry.fetchedAt) {
        obj[ip] = { label: entry.label, detail: entry.detail, fetchedAt: entry.fetchedAt }
      }
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // quota exceeded or storage disabled
  }
}

export function initStorage() {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return
    const obj = JSON.parse(raw) as Record<string, StoredEntry>
    const now = Date.now()
    for (const [ip, item] of Object.entries(obj)) {
      if (item && item.fetchedAt && now - item.fetchedAt <= CACHE_TTL_MS) {
        cache.set(ip, { status: 'success', label: item.label, detail: item.detail, fetchedAt: item.fetchedAt })
      }
    }
  } catch {
    // ignore
  }
}

initStorage()

export function getEntry(ip: string | null | undefined): IpGeoEntry {
  if (!ip) return IDLE_ENTRY
  const trimmed = ip.trim()
  if (!trimmed) return IDLE_ENTRY
  if (isPrivateIp(trimmed)) {
    return { status: 'private' }
  }
  return getFreshEntry(trimmed) ?? IDLE_ENTRY
}

export async function fetchOne(ip: string): Promise<void> {
  const trimmed = ip.trim()
  if (!trimmed || isPrivateIp(trimmed)) return
  const existing = getFreshEntry(trimmed)
  if (existing?.status === 'success' || existing?.status === 'loading') return

  cache.set(trimmed, { status: 'loading' })
  try {
    const resp = await fetch(`${GEO_SINGLE_URL}/${encodeURIComponent(trimmed)}.json`, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const detail: IpGeoDetail = {
      countryCode: data.country_code,
      region: data.region,
      city: data.city,
      organization: data.organization,
      timezone: data.timezone,
      accuracy: data.accuracy,
      latitude: data.latitude,
      longitude: data.longitude,
    }
    const label = formatGeoLabel(detail.countryCode, detail.region, detail.city)
    cache.set(trimmed, { status: 'success', label: label || '-', detail, fetchedAt: Date.now() })
    persistToStorage()
  } catch {
    cache.set(trimmed, { status: 'error' })
  }
}

export async function fetchBatch(ips: (string | null | undefined)[]): Promise<boolean> {
  const unique = Array.from(
    new Set(
      ips
        .map((ip) => ip?.trim())
        .filter((ip): ip is string => Boolean(ip) && !isPrivateIp(ip!) && getFreshEntry(ip!)?.status !== 'success')
    )
  )
  if (unique.length === 0) return true

  unique.forEach((ip) => cache.set(ip, { status: 'loading' }))

  for (let i = 0; i < unique.length; i += BATCH_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + BATCH_CHUNK_SIZE)
    try {
      const resp = await fetch(GEO_BATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const list = await resp.json()
      if (Array.isArray(list)) {
        list.forEach((item) => {
          if (!item?.ip) return
          const detail: IpGeoDetail = {
            countryCode: item.country_code,
            region: item.region,
            city: item.city,
            organization: item.organization,
            timezone: item.timezone,
            accuracy: item.accuracy,
            latitude: item.latitude,
            longitude: item.longitude,
          }
          const label = formatGeoLabel(detail.countryCode, detail.region, detail.city)
          cache.set(item.ip, { status: 'success', label: label || '-', detail, fetchedAt: Date.now() })
        })
      }
    } catch {
      chunk.forEach((ip) => cache.set(ip, { status: 'error' }))
      return false
    }
  }
  persistToStorage()
  return true
}
