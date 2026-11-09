/**
 * 注册邮箱黑名单输入解析（纯函数，与后端 NormalizeRegistrationEmailBlacklistEntry 对齐）。
 * 上游对照：frontend/src/utils/registrationEmailBlacklist.ts（v0.2.20）。
 * 校验：trim；仅 ASCII 大写转小写；去掉域名末尾的点；local ≤ 64 UTF-8 字节、无空白/
 * 无控制字符；域名须匹配域名模式；整地址 ≤ 254 UTF-8 字节。
 */

const TOKEN_SPLIT_RE = /[\s,，;；]+/
const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const LOCAL_MAX_BYTES = 64
const EMAIL_MAX_BYTES = 254
const utf8 = new TextEncoder()

function utf8Length(value: string): number {
  return utf8.encode(value).length
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

/** 返回归一化后的地址；token 不是合法邮箱时返回 null。 */
export function normalizeBlacklistEmail(raw: string): string | null {
  const value = String(raw ?? '').trim().replace(/[A-Z]+/g, (letters) => letters.toLowerCase())
  const at = value.indexOf('@')
  if (at <= 0) {
    return null
  }
  const local = value.slice(0, at)
  const domain = value.slice(at + 1).replace(/\.+$/, '')
  if (!domain || domain.includes('@')) {
    return null
  }
  if (utf8Length(local) > LOCAL_MAX_BYTES || /\s/.test(local) || hasControlChar(local)) {
    return null
  }
  if (!DOMAIN_PATTERN.test(domain)) {
    return null
  }
  const email = `${local}@${domain}`
  return utf8Length(email) > EMAIL_MAX_BYTES ? null : email
}

export interface ParsedBlacklistInput {
  /** 归一化、去重后的合法地址（输入顺序）。 */
  valid: string[]
  /** 非法 token（原始形式）。 */
  invalid: string[]
  /** 同一输入内因重复归一化结果而丢弃的 token 数。 */
  duplicates: number
}

/** 按空白、半角/全角逗号、分号切分粘贴文本。 */
export function parseBlacklistInput(input: string): ParsedBlacklistInput {
  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  let duplicates = 0
  for (const token of String(input ?? '').split(TOKEN_SPLIT_RE)) {
    if (!token) {
      continue
    }
    const email = normalizeBlacklistEmail(token)
    if (!email) {
      invalid.push(token)
      continue
    }
    if (seen.has(email)) {
      duplicates++
      continue
    }
    seen.add(email)
    valid.push(email)
  }
  return { valid, invalid, duplicates }
}

export interface MergeBlacklistResult {
  list: string[]
  added: string[]
  duplicates: number
}

/** 新地址前置、已有顺序不变；与已有名单重复的不再加入。 */
export function mergeIntoBlacklist(existing: string[], incoming: string[]): MergeBlacklistResult {
  const present = new Set(existing)
  const added: string[] = []
  for (const email of incoming) {
    if (present.has(email)) {
      continue
    }
    present.add(email)
    added.push(email)
  }
  return {
    list: [...added, ...existing],
    added,
    duplicates: incoming.length - added.length
  }
}

/** 批量禁用每批上限（上游 DISABLE_BATCH_SIZE）。 */
export const DISABLE_BATCH_SIZE = 1000

/** 把 id 列表切成每批至多 DISABLE_BATCH_SIZE 的批次。 */
export function chunkUserIds(userIds: number[], size: number = DISABLE_BATCH_SIZE): number[][] {
  const chunks: number[][] = []
  for (let i = 0; i < userIds.length; i += size) {
    chunks.push(userIds.slice(i, i + size))
  }
  return chunks
}

/** 编辑器列表只渲染前 N 条（上游 VISIBLE_LIMIT）。 */
export const BLACKLIST_VISIBLE_LIMIT = 200
