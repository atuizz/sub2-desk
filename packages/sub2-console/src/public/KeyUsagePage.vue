<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from 'vue';
import { MacButton } from '@sub2-mac/core';
import { queryKeyUsage, type KeyUsageResult } from '../api/public';
const key = ref('');
const date = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const start = ref(date()); const end = ref(date()); const days = ref(30);
const loading = ref(false); const error = ref(''); const result = ref<KeyUsageResult | null>(null);
let generation = 0; let controller: AbortController | undefined;
function clear() { generation++; controller?.abort(); key.value = ''; result.value = null; error.value = ''; loading.value = false; }
onBeforeUnmount(clear);
watch([key, start, end, days], () => { generation++; controller?.abort(); result.value = null; error.value = ''; loading.value = false; }, { flush: 'sync' });
function preset(count: number) { end.value = date(); start.value = date(new Date(Date.now() - count * 86400000)); }
async function query() {
  if (loading.value) return;
  const request = ++generation; controller?.abort(); controller = new AbortController();
  result.value = null; error.value = ''; loading.value = true;
  try {
    const data = await queryKeyUsage(key.value, { start_date: start.value, end_date: end.value, days: days.value,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }, controller.signal);
    if (request === generation) result.value = data;
  } catch (e) { if (request === generation) error.value = e instanceof Error ? e.message : '查询失败，请重试。'; }
  finally { if (request === generation) loading.value = false; }
}
const money = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : `$${n.toFixed(4)}`;
const number = (n?: number | null) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('zh-CN');
const status = computed(() => result.value?.status ? ({ active: '正常', expired: '已过期', quota_exhausted: '额度已耗尽' }[result.value.status] || result.value.status) : result.value?.isValid === false ? '不可用' : '未提供');
const subscriptionLimits = computed(() => {
  const s = result.value?.subscription;
  return s ? [['日', s.daily_usage_usd, s.daily_limit_usd], ['周', s.weekly_usage_usd, s.weekly_limit_usd], ['月', s.monthly_usage_usd, s.monthly_limit_usd]] as const : [];
});
</script>
<template>
  <section>
    <form class="public-form" @submit.prevent="query">
      <label class="public-grow">API 密钥<input v-model="key" aria-label="API 密钥" type="password" autocomplete="off" spellcheck="false" required /></label>
      <label>开始日期<input v-model="start" type="date" required /></label><label>结束日期<input v-model="end" type="date" :min="start" required /></label>
      <label>每日明细<select v-model.number="days"><option :value="7">7 天</option><option :value="30">30 天</option><option :value="90">90 天</option></select></label>
      <MacButton type="submit" variant="primary" :disabled="loading || !key.trim()">{{ loading ? '查询中…' : '查询' }}</MacButton>
      <MacButton type="button" @click="clear">清除</MacButton>
    </form>
    <div class="public-nav"><MacButton @click="preset(0)">今天</MacButton><MacButton @click="preset(7)">近 7 天</MacButton><MacButton @click="preset(30)">近 30 天</MacButton></div>
    <p v-if="error" class="public-message public-error" role="alert">{{ error }}</p>
    <p v-else-if="!result" class="public-message" role="status">{{ loading ? '正在读取密钥用量…' : '输入密钥查看额度和用量。密钥仅用于本次查询，不保存到浏览器。' }}</p>
    <template v-if="result">
      <h2>{{ result.planName || (result.mode === 'quota_limited' ? '限额密钥' : '余额与订阅') }}</h2>
      <dl class="public-facts"><dt>状态</dt><dd>{{ status }}</dd><dt>余额</dt><dd>{{ money(result.balance) }}</dd><dt>剩余额度</dt><dd>{{ money(result.quota?.remaining ?? result.remaining) }}</dd><dt>到期时间</dt><dd>{{ result.expires_at || result.subscription?.expires_at || '未提供' }}</dd>
        <template v-if="result.quota"><dt>已用 / 总额度</dt><dd>{{ money(result.quota.used) }} / {{ money(result.quota.limit) }}</dd></template>
        <template v-for="limit in result.rate_limits || []" :key="limit.window"><dt>{{ limit.window }} 额度</dt><dd>{{ money(limit.used) }} / {{ money(limit.limit) }}<br />重置：{{ limit.reset_at || '未提供' }}</dd></template>
        <template v-for="limit in subscriptionLimits" :key="limit[0]"><dt>{{ limit[0] }}额度</dt><dd>{{ money(limit[1]) }} / {{ money(limit[2]) }}</dd></template>
      </dl>
      <div v-if="result.usage" class="public-table-wrap"><table class="public-table"><thead><tr><th>用量</th><th>今日</th><th>所选范围</th></tr></thead><tbody>
        <tr><th>请求数</th><td>{{ number(result.usage.today?.requests) }}</td><td>{{ number(result.usage.total?.requests) }}</td></tr>
        <tr><th>输入 Token</th><td>{{ number(result.usage.today?.input_tokens) }}</td><td>{{ number(result.usage.total?.input_tokens) }}</td></tr>
        <tr><th>输出 Token</th><td>{{ number(result.usage.today?.output_tokens) }}</td><td>{{ number(result.usage.total?.output_tokens) }}</td></tr>
        <tr><th>总 Token</th><td>{{ number(result.usage.today?.total_tokens) }}</td><td>{{ number(result.usage.total?.total_tokens) }}</td></tr>
        <tr><th>缓存写入 Token</th><td>{{ number(result.usage.today?.cache_creation_tokens) }}</td><td>{{ number(result.usage.total?.cache_creation_tokens) }}</td></tr>
        <tr><th>缓存读取 Token</th><td>{{ number(result.usage.today?.cache_read_tokens) }}</td><td>{{ number(result.usage.total?.cache_read_tokens) }}</td></tr>
        <tr><th>实际费用</th><td>{{ money(result.usage.today?.actual_cost) }}</td><td>{{ money(result.usage.total?.actual_cost) }}</td></tr>
      </tbody></table></div>
      <h2>每日明细</h2><p v-if="!result.daily_usage?.length" class="public-message">暂无每日记录。</p>
      <div v-else class="public-table-wrap"><table class="public-table"><thead><tr><th>日期</th><th>请求</th><th>输入 / 输出 Token</th><th>缓存读 / 写</th><th>费用</th></tr></thead><tbody><tr v-for="row in result.daily_usage" :key="row.date"><td>{{ row.date }}</td><td>{{ number(row.requests) }}</td><td>{{ number(row.input_tokens) }} / {{ number(row.output_tokens) }}</td><td>{{ number(row.cache_read_tokens) }} / {{ number(row.cache_write_tokens) }}</td><td>{{ money(row.actual_cost ?? row.cost) }}</td></tr></tbody></table></div>
      <h2>模型用量</h2><p v-if="!result.model_stats?.length" class="public-message">暂无模型记录。</p>
      <div v-else class="public-table-wrap"><table class="public-table"><thead><tr><th>模型</th><th>请求</th><th>输入 / 输出</th><th>缓存读 / 写</th><th>总 Token</th><th>费用</th></tr></thead><tbody><tr v-for="row in result.model_stats" :key="row.model"><td>{{ row.model }}</td><td>{{ number(row.requests) }}</td><td>{{ number(row.input_tokens) }} / {{ number(row.output_tokens) }}</td><td>{{ number(row.cache_read_tokens) }} / {{ number(row.cache_creation_tokens) }}</td><td>{{ number(row.total_tokens) }}</td><td>{{ money(row.actual_cost ?? row.cost) }}</td></tr></tbody></table></div>
    </template>
  </section>
</template>
