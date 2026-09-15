export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
// Wire bytes, including JSON/base64 overhead; independent of decoded/file budgets.
export const MAX_REQUEST_BODY_BYTES = 268435456;
export function validateJsonRequestBody(payload: unknown): number {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > MAX_REQUEST_BODY_BYTES) throw new Error('请求内容超过256 MiB，请拆分后重试。');
  return bytes;
}
export function validateDesktopFiles(files: readonly Pick<File, 'name'|'size'>[]): string {
  if (!files.length) return '没有可读取的文件，请拖入 JSON 文件。';
  if (files.length > 10) return '一次最多拖入10个 JSON 文件。';
  if (files.some(file => !/\.json$/i.test(file.name))) return '目前支持账号 JSON 文件，请把其他文件移出本次拖放。';
  if (files.some(file => file.size <= 0 || file.size > MAX_IMPORT_FILE_BYTES)) return '每个 JSON 文件需非空且不超过20 MB。';
  if (files.reduce((size, file) => size + file.size, 0) > 50 * 1024 * 1024) return '本次文件合计超过50 MB，请分批导入。';
  return '';
}
