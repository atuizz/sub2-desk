import type { MonitorCoverage, MonitorMatrixRow } from '../api/channelMonitorV2';

export function readMonitorQuery(search: string, allowUsers: boolean) {
  const q = new URLSearchParams(search);
  const pick = <T extends string>(key: string, values: readonly T[], fallback: T): T => values.includes(q.get(key) as T) ? q.get(key) as T : fallback;
  const csv = (key: string) => [...new Set(q.getAll(key).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean))];
  return {
    filter: { range: pick('range', ['90m', '24h', '7d', '30d'] as const, '90m'), platforms: csv('platform'), groupIds: [...new Set(csv('group').map(Number).filter(id => Number.isSafeInteger(id) && id > 0))], models: csv('model') },
    groupBy: pick('group_by', ['platform', 'platform_group', 'platform_model', 'platform_group_model'] as const, 'platform_group'),
    mode: pick('health_mode', ['overall', 'success', 'ttft', 'cache'] as const, 'overall'),
    view: pick('trend_view', ['pulse', 'line'] as const, 'pulse'),
    tab: pick('tab', allowUsers ? ['models', 'errors', 'users'] as const : ['models', 'errors'] as const, 'models'),
  };
}
export function writeMonitorQuery(search: string, state: ReturnType<typeof readMonitorQuery>) {
  const q = new URLSearchParams(search);
  const values = { range: state.filter.range, platform: state.filter.platforms.join(','), group: state.filter.groupIds.join(','), model: state.filter.models.join(','), group_by: state.groupBy, health_mode: state.mode, trend_view: state.view, tab: state.tab };
  for (const [key, value] of Object.entries(values)) { q.delete(key); if (value) q.set(key, value); }
  return q.toString();
}
export function zoomMatrix(count: number, begin: number, size: number, delta: number, anchor: number) {
  const sizes = [30, 60, 120];
  const next = sizes[Math.max(0, Math.min(2, sizes.indexOf(size) + (delta > 0 ? 1 : delta < 0 ? -1 : 0)))];
  const ratio = Math.max(0, Math.min(1, anchor));
  return { size: next, offset: Math.max(0, Math.min(Math.max(0, count - next), Math.round(begin + ratio * Math.min(size, count) - ratio * Math.min(next, count)))) };
}

// Selected interval is [start,end), not merely the observed rows' union.
// Render a bounded window so long histories do not create thousands of buttons per row.
export function matrixWindow(rows: MonitorMatrixRow[], coverage: MonitorCoverage | undefined, offset: number, size: number) {
  const step = Math.max(60, coverage?.bucket_seconds || 60) * 1000;
  const from = Date.parse(coverage?.requested_start || '');
  const requestedEnd = Date.parse(coverage?.requested_end || '');
  const end = Number.isFinite(requestedEnd) && requestedEnd > from ? requestedEnd : Date.parse(coverage?.data_through || '');
  const start = Math.floor(from / step) * step;
  const count = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.ceil((end - start) / step) : 0;
  const width = Math.max(1, Math.min(120, Math.floor(size) || 60));
  const begin = Math.max(0, Math.min(Math.floor(offset) || 0, Math.max(0, count - width)));
  const times = Array.from({ length: Math.min(width, count) }, (_, index) => start + (begin + index) * step);
  return { count, begin, times, rows: rows.map(row => {
    const buckets = new Map(row.buckets.map(bucket => [Date.parse(bucket.bucket_start), bucket]));
    return { row, slots: times.map(time => ({ time, bucket: buckets.get(time) })) };
  }) };
}
