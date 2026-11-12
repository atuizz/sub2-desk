<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import PlatformMark from '@/apps/admin/accounts/PlatformMark.vue';
import { platformDisplayName } from '@/constants/platformCatalog';

// A shared presentation of the existing Group contract. Filtering never changes selection.
type Choice = { id: number; name: string; platform: string; description?: string | null; rate_multiplier?: number };
const props = withDefaults(defineProps<{
  modelValue: number | null | number[]; groups: Choice[]; multiple?: boolean; disabled?: boolean;
  label?: string; allowDefault?: boolean;
}>(), { multiple: false, disabled: false, label: '分组', allowDefault: false });
const emit = defineEmits<{ 'update:modelValue': [value: number | null | number[]] }>();
const id = useId();
const expanded = ref(false), query = ref(''), platform = ref('');
const navigatingRadios = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const optionsPanel = ref<HTMLElement | null>(null);
const selectedIds = computed(() => Array.isArray(props.modelValue) ? props.modelValue : props.modelValue === null ? [] : [props.modelValue]);
const selected = computed(() => props.groups.find(group => group.id === props.modelValue));
const unknownIds = computed(() => selectedIds.value.filter(value => !props.groups.some(group => group.id === value)));
const platforms = computed(() => [...new Set(props.groups.map(group => group.platform))]);
const visible = computed(() => props.groups.filter(group =>
  (!platform.value || group.platform === platform.value) &&
  `${group.name} ${group.description || ''} ${platformDisplayName(group.platform)} ${group.platform}`.toLowerCase().includes(query.value.trim().toLowerCase()),
));
const summary = computed(() => props.multiple ? `已关联 ${selectedIds.value.length} 个分组` :
  selected.value?.name || (props.modelValue === null ? '继承默认分组' : `当前分组 #${props.modelValue}`));
async function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value) {
    await nextTick();
    search.value?.focus({ preventScroll: true });
    optionsPanel.value?.scrollIntoView({ block: 'end' });
  }
}
function choose(value: number | null, checked = true, closeAfter = !navigatingRadios.value) {
  if (props.disabled) return;
  if (props.multiple && value !== null) {
    emit('update:modelValue', checked ? [...new Set([...selectedIds.value, value])] : selectedIds.value.filter(id => id !== value));
  } else {
    emit('update:modelValue', value);
    if (closeAfter) {
      expanded.value = false;
      void nextTick(() => trigger.value?.focus());
    }
  }
}
function onEscape(event: KeyboardEvent) {
  if (!expanded.value) return;
  event.preventDefault(); event.stopPropagation();
  expanded.value = false; trigger.value?.focus();
}
function onEnter(event: KeyboardEvent) {
  if (event.target instanceof HTMLInputElement) {
    event.preventDefault();
    if (event.target.type === 'radio') choose(event.target.value === '' ? null : Number(event.target.value), true, true);
    else if (event.target.type !== 'search') event.target.click();
  }
}
</script>

<template>
  <div class="group-picker" :data-mac-keyboard-scope="expanded ? '' : undefined" @keydown.esc="onEscape" @keydown.enter.stop="onEnter" @keydown="navigatingRadios = $event.key.startsWith('Arrow')" @keyup="navigatingRadios = false" @pointerdown="navigatingRadios = false">
    <div :id="`${id}-label`" class="group-picker-label">{{ label }}</div>
    <button ref="trigger" type="button" class="group-picker-trigger" :disabled="disabled"
      :aria-expanded="expanded" :aria-controls="`${id}-options`" :aria-labelledby="`${id}-label ${id}-value`" @click="toggle">
      <PlatformMark v-if="selected" :platform="selected.platform" />
      <span class="group-picker-summary"><strong :id="`${id}-value`">{{ summary }}</strong>
        <small>{{ multiple ? '按平台查找，可选择多个分组' : selected ? platformDisplayName(selected.platform) : '选择分组以确定可用模型与费率' }}</small>
      </span>
      <span v-if="selected?.rate_multiplier != null" class="group-rate">{{ selected.rate_multiplier }}× <small>倍率</small></span>
      <span class="group-picker-chevron" aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span>
    </button>
    <div v-if="expanded" ref="optionsPanel" :id="`${id}-options`" class="group-picker-options">
      <fieldset :disabled="disabled">
        <legend class="sr-only">{{ label }}选项</legend>
        <div class="group-platforms" role="group" aria-label="按平台筛选分组">
          <button type="button" :aria-pressed="!platform" @click="platform = ''">全部 <span>{{ groups.length }}</span></button>
          <button v-for="item in platforms" :key="item" type="button" :aria-pressed="platform === item" @click="platform = item">
            <PlatformMark :platform="item" />{{ platformDisplayName(item) }}
          </button>
        </div>
        <input ref="search" v-model="query" @input.stop @change.stop class="group-search" type="search" placeholder="搜索分组名称或说明…" :aria-label="`搜索${label}`" @keydown.enter.prevent />
        <div class="group-picker-results">
          <label v-if="allowDefault && !multiple" class="group-option" :data-selected="modelValue === null">
            <input type="radio" :name="id" value="" :checked="modelValue === null" @change="choose(null)" />
            <span class="group-option-copy"><strong>继承默认分组</strong><small>使用账户的默认分组设置</small></span>
          </label>
          <label v-for="group in visible" :key="group.id" class="group-option" :data-selected="selectedIds.includes(group.id)">
            <input :type="multiple ? 'checkbox' : 'radio'" :name="id" :value="group.id" :checked="selectedIds.includes(group.id)" @change="choose(group.id, ($event.target as HTMLInputElement).checked)" />
            <PlatformMark :platform="group.platform" />
            <span class="group-option-copy"><strong>{{ group.name }}</strong><small>{{ group.description || platformDisplayName(group.platform) }}</small></span>
            <span v-if="group.rate_multiplier != null" class="group-rate">{{ group.rate_multiplier }}× <small>倍率</small></span>
          </label>
          <p v-if="!visible.length" class="group-picker-empty">{{ groups.length ? '没有匹配的分组，试试其他关键词或平台。' : '暂无可选分组。' }}</p>
        </div>
        <div class="group-picker-hint" aria-live="polite">{{ visible.length }} 个匹配分组<span v-if="multiple"> · 已选择 {{ selectedIds.length }} 个</span></div>
      </fieldset>
    </div>
    <p v-if="unknownIds.length" class="group-picker-hint">分组 {{ unknownIds.map(id => `#${id}`).join('、') }} 不在当前可选列表中，已保留原选择。</p>
  </div>
</template>

<style scoped>
.group-picker{min-width:0;font-size:12px;color:var(--text-primary)}
.group-picker-label{font-weight:600;margin-bottom:7px;color:var(--text-secondary)}
.group-picker-trigger{display:flex;align-items:center;gap:10px;width:100%;min-height:62px;padding:11px 13px;text-align:left;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;cursor:pointer}
.group-picker-trigger[aria-expanded=true]{border-color:var(--accent);box-shadow:0 0 0 3px var(--selection-bg)}
.group-picker-trigger:disabled{opacity:.6;cursor:not-allowed}.group-picker-summary{display:grid;gap:4px;flex:1;min-width:0}.group-picker-summary strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}.group-picker-summary small{color:var(--text-secondary);font-size:11px}.group-picker-chevron{font-size:18px;color:var(--text-secondary)}
.group-picker-options{margin-top:9px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-surface);overflow:hidden}
fieldset{border:0;padding:0;margin:0;min-width:0}
.group-platforms{display:flex;flex-wrap:wrap;gap:6px;padding:12px 12px 8px;background:var(--bg-surface-subtle)}
.group-platforms button{display:flex;align-items:center;gap:5px;min-height:32px;padding:4px 9px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg-surface);color:var(--text-secondary);font-size:11px}
.group-platforms button[aria-pressed=true]{color:var(--accent);border-color:var(--accent);background:var(--selection-bg);font-weight:600}
.group-platforms :deep(.platform-mark){width:19px;height:19px}.group-platforms :deep(.platform-mark svg),.group-platforms :deep(.platform-mark img){width:16px;height:16px}
.group-search{display:block;width:calc(100% - 24px);height:34px;margin:10px 12px;padding:0 10px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-surface);color:var(--text-primary);font:inherit}
.group-picker-results{max-height:220px;overflow:auto;overscroll-behavior:contain;padding:0 6px 6px;scrollbar-gutter:stable}
.group-option{display:flex;align-items:center;gap:9px;min-height:60px;margin:2px 0;padding:10px;border:1px solid transparent;border-radius:7px;cursor:pointer}
.group-option:hover{background:var(--bg-surface-subtle)}.group-option[data-selected=true]{background:var(--selection-bg);border-color:color-mix(in srgb,var(--accent) 28%,transparent)}
.group-option input{flex:0 0 auto;width:15px;height:15px;margin:0;accent-color:var(--accent)}
.group-option-copy{flex:1;min-width:0;display:grid;gap:4px}.group-option-copy strong{font-size:12px;font-weight:600;overflow-wrap:anywhere}.group-option-copy small{font-size:11px;color:var(--text-secondary);line-height:1.5;white-space:normal;overflow-wrap:anywhere}
.group-rate{flex:0 0 auto;color:var(--selection-ink);font-size:12px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}.group-rate small{font-size:10px;font-weight:400;color:var(--text-secondary)}
.group-picker-empty{padding:20px 12px;color:var(--text-secondary);font-size:12px}.group-picker-hint{padding:8px 12px;color:var(--text-secondary);font-size:11px;line-height:1.5;background:var(--bg-surface-subtle)}
@media(max-width:500px){.group-option{gap:7px;padding:9px 6px}.group-option>.platform-mark{display:none}.group-rate small{display:none}}
</style>
