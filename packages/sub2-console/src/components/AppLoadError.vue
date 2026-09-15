<script setup lang="ts">
function reload() { window.location.reload(); }
</script>
<template>
  <div class="app-load-error" role="alert">
    <h2>应用暂时无法打开</h2>
    <p>请检查网络连接。若控制台刚刚更新，刷新页面后再试。</p>
    <button type="button" @click="reload">刷新页面</button>
  </div>
</template>
<style scoped>
.app-load-error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px; text-align: center; background: var(--window-bg-solid); }
h2 { font-size: 16px; font-weight: 600; } p { font-size: 12px; color: var(--text-secondary); max-width: 310px; line-height: 1.7; }
button { font-size: 12px; padding: 7px 15px; background: var(--accent); color: white; border-radius: 7px; }
</style>
