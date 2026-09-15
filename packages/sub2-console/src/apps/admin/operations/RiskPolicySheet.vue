<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import { riskControlAPI, type ContentModerationConfig, type UpdateContentModerationConfig } from '../../../api/admin/riskControl';
import { adminError } from '../admin-feedback';
const emit = defineEmits<{ close: []; saved: [] }>();
const config = ref<ContentModerationConfig | null>(null), loading = ref(false), saving = ref(false), error = ref('');
const groups = ref(''), models = ref(''), keywords = ref('');
let epoch = 0;
async function load() {
  const version = ++epoch; loading.value = true; error.value = ''; config.value = null;
  try {
    const data = await riskControlAPI.getConfig(); if (version !== epoch) return;
    config.value = JSON.parse(JSON.stringify(data));
    groups.value = data.group_ids.join(','); models.value = data.model_filter.models.join('\n'); keywords.value = data.blocked_keywords.join('\n');
  } catch (err) { if (version === epoch) error.value = adminError(err, '策略读取失败'); }
  finally { if (version === epoch) loading.value = false; }
}
function policyPayload(): UpdateContentModerationConfig {
  const c = config.value; if (!c) throw new Error('请先读取策略');
  const ids = groups.value.split(/[,，\s]+/).filter(Boolean).map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('分组 ID 必须是正整数');
  if (!c.all_groups && !ids.length) throw new Error('请选择至少一个分组，或启用全部分组');
  if (!Number.isFinite(c.sample_rate) || c.sample_rate < 0 || c.sample_rate > 1) throw new Error('采样率应介于0和1');
  if (c.non_hit_retention_days > 3) throw new Error('未命中记录最多保留3天');
  const thresholds = { ...c.thresholds };
  for (const value of Object.values(thresholds)) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('分类阈值应介于0和1');
  for (const key of ['ban_threshold','violation_window_hours','hit_retention_days','non_hit_retention_days'] as const)
    if (!Number.isSafeInteger(c[key]) || c[key] < 1) throw new Error('封禁和保留周期应为正整数');
  if (!Number.isInteger(c.block_status) || c.block_status < 400 || c.block_status > 599) throw new Error('拦截状态码应介于400和599');
  const modelList = [...new Set(models.value.split('\n').map(s => s.trim()).filter(Boolean))];
  if (c.model_filter.type !== 'all' && !modelList.length) throw new Error('请填写模型列表，或选择全部模型');
  return { sample_rate: c.sample_rate, all_groups: c.all_groups, group_ids: c.all_groups ? [] : [...new Set(ids)], record_non_hits: c.record_non_hits,
    thresholds, block_status: c.block_status, block_message: c.block_message, email_on_hit: c.email_on_hit,
    auto_ban_enabled: c.auto_ban_enabled, ban_threshold: c.ban_threshold, violation_window_hours: c.violation_window_hours,
    hit_retention_days: c.hit_retention_days, non_hit_retention_days: c.non_hit_retention_days,
    pre_hash_check_enabled: c.pre_hash_check_enabled, blocked_keywords: [...new Set(keywords.value.split('\n').map(s => s.trim()).filter(Boolean))],
    keyword_blocking_mode: c.keyword_blocking_mode, model_filter: { type: c.model_filter.type, models: modelList },
    cyber_policy_exclude_from_ban_count: c.cyber_policy_exclude_from_ban_count };
}
async function save() {
  if (saving.value || loading.value || !config.value) return;
  const version = epoch; error.value = '';
  try {
    const payload = policyPayload(); saving.value = true;
    await riskControlAPI.updateConfig(payload); if (version !== epoch) return;
    emit('saved'); emit('close');
  } catch (err) { if (version === epoch) error.value = adminError(err, '策略保存失败'); }
  finally { if (version === epoch) saving.value = false; }
}
onMounted(load); onUnmounted(() => { epoch++; });
</script>
<template>
  <MacSheet protect-changes :show="true" title="内容审核策略" :loading="saving" @close="emit('close')">
    <p v-if="loading" role="status">正在读取策略…</p><div v-if="error" role="alert">{{ error }}<MacButton v-if="!config" :disabled="loading" @click="load">重试</MacButton></div>
    <form v-if="config" class="risk-policy" @submit.prevent="save">
      <fieldset><legend>审核范围</legend>
        <label><input v-model="config.all_groups" type="checkbox" />全部分组</label><label v-if="!config.all_groups">分组 ID（逗号分隔）<input v-model="groups" /></label>
        <label>采样率（0–1）<input v-model.number="config.sample_rate" type="number" min="0" max="1" step="0.01" /></label>
        <label>模型范围<select v-model="config.model_filter.type"><option value="all">全部模型</option><option value="include">仅指定模型</option><option value="exclude">排除指定模型</option></select></label>
        <label v-if="config.model_filter.type !== 'all'">模型（每行一个）<textarea v-model="models" rows="3" /></label>
      </fieldset>
      <fieldset><legend>命中与拦截</legend>
        <label>关键词判定<select v-model="config.keyword_blocking_mode"><option value="keyword_only">仅关键词</option><option value="keyword_and_api">关键词与审核接口</option><option value="api_only">仅审核接口</option></select></label>
        <label>拦截关键词（每行一个）<textarea v-model="keywords" rows="4" /></label>
        <label v-for="(_, category) in config.thresholds" :key="category">{{ category }} 阈值<input v-model.number="config.thresholds[category]" type="number" min="0" max="1" step="0.01" /></label>
        <label><input v-model="config.pre_hash_check_enabled" type="checkbox" />复用已命中内容判定</label>
        <label>拦截状态码<input v-model.number="config.block_status" type="number" min="400" max="599" /></label><label>拦截提示<textarea v-model="config.block_message" /></label>
        <label><input v-model="config.email_on_hit" type="checkbox" />命中时发送邮件</label>
      </fieldset>
      <fieldset><legend>自动封禁</legend><label><input v-model="config.auto_ban_enabled" type="checkbox" />启用自动封禁</label>
        <label>累计违规次数<input v-model.number="config.ban_threshold" type="number" min="1" /></label><label>违规统计窗口（小时）<input v-model.number="config.violation_window_hours" type="number" min="1" /></label>
        <label><input v-model="config.cyber_policy_exclude_from_ban_count" type="checkbox" />网络政策命中不计入封禁次数</label>
      </fieldset>
      <fieldset><legend>记录保留</legend><label><input v-model="config.record_non_hits" type="checkbox" />记录未命中请求</label><label>命中记录（天）<input v-model.number="config.hit_retention_days" type="number" min="1" /></label><label>未命中记录（天）<input v-model.number="config.non_hit_retention_days" type="number" min="1" max="3" /></label></fieldset>
    </form>
    <template #footer="{ close }"><MacButton :disabled="saving" @click="close">取消</MacButton><MacButton variant="primary" :disabled="saving || loading || !config" @click="save">保存策略</MacButton></template>
  </MacSheet>
</template>
<style scoped>
.risk-policy, fieldset { display: grid; gap: 12px; } fieldset { padding: 12px 0; border: 0; border-top: 1px solid var(--border-color); } legend { font-weight: 600; } label { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } input, select, textarea { min-width: 0; max-width: 100%; padding: 6px; color: var(--text-primary); background: var(--window-bg-solid); border: 1px solid var(--border-color); border-radius: 6px; } textarea { width: 100%; }
</style>
