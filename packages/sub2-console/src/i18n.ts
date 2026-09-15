export function getLocale(): string {
  return localStorage.getItem('locale') || 'zh-CN';
}
