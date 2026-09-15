<script setup lang="ts">
import './admin-polish.css';
withDefaults(defineProps<{ loading?: boolean; error?: string; notice?: string; context?: string }>(), {
  loading: false, error: '', notice: '', context: ''
});
defineEmits<{ retry: []; dismiss: [] }>();
</script>

<template>
  <div v-if="loading" class="admin-load-status" role="status">
    <span class="admin-load-indicator" aria-hidden="true"></span>正在加载…
  </div>
  <div v-else-if="error" class="admin-load-error" role="alert">
    <span>{{ error }}</span><button type="button" @click="$emit('retry')">重新加载</button>
  </div>

    <div v-if="notice" class="admin-action-notice" role="alert">
      <div><strong>{{ context || '操作未完成' }}</strong><p>{{ notice }}</p></div>
      <button type="button" aria-label="关闭操作提示" @click="$emit('dismiss')">关闭</button>
    </div>

</template>

<style scoped>
.admin-load-status, .admin-load-error { flex-shrink: 0; display: flex; align-items: center; gap: 9px; padding: 9px 18px; font: 11px var(--font-mac); border-bottom: 1px solid var(--border-subtle); background: var(--window-bg-solid); color: var(--text-secondary); }
.admin-load-error { justify-content: space-between; background: color-mix(in srgb, var(--color-warning) 7%, var(--bg-surface)); }
.admin-load-error > span { overflow-wrap: anywhere; min-width: 0; }
.admin-load-error button { flex-shrink: 0; color: var(--accent); min-height: 26px; }
.admin-load-indicator { width: 11px; height: 11px; border: 1.5px solid var(--border-color); border-top-color: var(--accent); border-radius: 50%; animation: admin-loading .7s linear infinite; }
.admin-action-notice { position: absolute; right: 16px; bottom: 52px; z-index: 80; display: flex; align-items: flex-start; gap: 16px; width: min(380px, calc(100% - 32px)); padding: 14px 16px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--material-dropdown, #fff); backdrop-filter: var(--vibrancy-dropdown); color: var(--text-primary); box-shadow: var(--shadow-overlay); font: 12px var(--font-mac); }
.admin-action-notice > div { min-width: 0; flex: 1; }
.admin-action-notice strong { font-size: 12px; font-weight: 600; }
.admin-action-notice p { margin-top: 5px; line-height: 1.65; color: var(--text-secondary); overflow-wrap: anywhere; }
.admin-action-notice button { flex-shrink: 0; font-size: 11px; color: var(--accent); min-height: 26px; }
.admin-action-notice button:focus-visible, .admin-load-error button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
@keyframes admin-loading { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .admin-load-indicator { animation: none; } }
</style>
