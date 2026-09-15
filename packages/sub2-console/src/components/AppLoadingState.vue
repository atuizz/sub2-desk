<template>
  <div class="app-loading-state" role="status" aria-live="polite">
    <div class="app-loading-spinner"></div>
    <p>正在打开应用</p>
    <span>首次打开可能需要片刻</span>
  </div>
</template>

<style scoped>
.app-loading-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; min-height: 160px; background: var(--window-bg-solid); color: var(--text-secondary); font-size: 13px; }
.app-loading-state span { color: var(--text-tertiary); font-size: 11px; }
.app-loading-spinner { width: 24px; height: 24px; margin-bottom: 5px; border: 2px solid var(--border-color); border-top-color: var(--accent); border-radius: 50%; animation: spin .75s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
