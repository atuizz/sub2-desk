<script setup lang="ts">
import { ref, nextTick } from 'vue';
import './app-polish.css';
import type { WindowInstance } from '@sub2-mac/core';
import { useSystemStore } from '../../stores/system';
import { useAuthStore } from '../../stores/auth';
import { buildApiUrl, buildGatewayUrl } from '../../api/url';
import { formatBalance } from '../../utils/format';

defineProps<{
  win?: WindowInstance;
}>();

const systemStore = useSystemStore();
const authStore = useAuthStore();

interface HistoryItem {
  type: 'input' | 'output' | 'error';
  text: string;
}

const history = ref<HistoryItem[]>([
  { type: 'output', text: 'Sub2 Desk Developer Shell v1.0.0 (Sub2API compatible console)' },
  { type: 'output', text: 'Type "help" or "sub2ctl status" to inspect system state.' }
]);

const currentInput = ref('');
const isRunning = ref(false);
const commandHistory = ref<string[]>([]);
let commandIndex = 0;
function recallCommand(direction: number) {
  commandIndex = Math.max(0, Math.min(commandHistory.value.length, commandIndex + direction));
  currentInput.value = commandHistory.value[commandIndex] ?? '';
}
const terminalBody = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    if (terminalBody.value) {
      terminalBody.value.scrollTop = terminalBody.value.scrollHeight;
    }
  });
}

async function handleCommand() {
  const cmd = currentInput.value.trim();
  if (!cmd || isRunning.value) return;
  isRunning.value = true;
  commandHistory.value.push(cmd);
  commandIndex = commandHistory.value.length;

  history.value.push({ type: 'input', text: `sub2api@gateway ~ % ${cmd}` });
  currentInput.value = '';

  const lower = cmd.toLowerCase();
  try {

  if (lower === 'clear') {
    history.value = [];
  } else if (lower === 'help') {
    history.value.push({
      type: 'output',
      text: `可用指令:
  sub2ctl status     - 探测已配置的后端状态与系统信息
  sub2ctl ping       - 实时测量网关 RTT 往返延迟
  sub2ctl user       - 查看当前认证用户与权限
  curl <url>         - 执行实时 HTTP GET 请求并打印响应
  theme [dark|light] - 切换系统外观模式
  uname -a           - 打印系统内核版本
  clear              - 清空终端屏幕`
    });
  } else if (lower === 'sub2ctl status') {
    history.value.push({ type: 'output', text: '正在探测网关状态...' });
    try {
      const t0 = performance.now();
      const res = await fetch(buildApiUrl('/settings/public'));
      const rtt = Math.round(performance.now() - t0);
      const payload = await res.json();
      const data = payload.data ?? payload;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      history.value.push({
        type: 'output',
        text: `[Sub2API 网关状态]
● 状态: 在线 (HTTP ${res.status} OK)
● 网关地址: ${buildGatewayUrl('/')}
● 往返延迟: ${rtt} ms
● 站点名称: ${data.site_name || 'Sub2API'}
● 注册开放: ${data.allow_registration ? '是' : '否'}
● 密码登录: ${data.allow_password_login ? '是' : '否'}
● 邮箱验证: ${data.require_email_verification ? '是' : '否'}
● 风控系统: ${data.risk_control_enabled ? '已启用' : '未启用'}`
      });
    } catch (err: any) {
      history.value.push({
        type: 'error',
        text: `连接网关失败: ${err.message}`
      });
    }
  } else if (lower === 'sub2ctl ping') {
    try {
      const t0 = performance.now();
      const response = await fetch(buildApiUrl('/settings/public'));
      const rtt = (performance.now() - t0).toFixed(2);
      history.value.push({
        type: 'output',
        text: `PING ${buildGatewayUrl('/health')} (http-probe):
HTTP probe: http_status=${response.status} time=${rtt} ms
1 packets transmitted, 1 received, 0.0% loss, rtt=${rtt} ms`
      });
    } catch (err: any) {
      history.value.push({ type: 'error', text: `Ping 失败: ${err.message}` });
    }
  } else if (lower === 'sub2ctl user') {
    history.value.push({
      type: 'output',
      text: `[当前会话]
● 用户名: ${authStore.user?.username || '—'}
● 邮箱: ${authStore.user?.email || '未登录'}
● 角色: ${authStore.user?.role || 'guest'}
● 余额: $${authStore.user ? formatBalance(authStore.user.balance) : '—'}
● 登录状态: ${authStore.isAuthenticated ? '已认证' : '未认证'}`
    });
  } else if (lower.startsWith('curl ')) {
    const url = cmd.slice(5).trim();
    history.value.push({ type: 'output', text: `正在请求 ${url} ...` });
    try {
      const res = await fetch(url);
      const text = await res.text();
      let preview = text;
      try {
        preview = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
      history.value.push({
        type: 'output',
        text: `HTTP ${res.status} ${res.statusText}\n${preview.slice(0, 1000)}`
      });
    } catch (err: any) {
      history.value.push({ type: 'error', text: `cURL 失败: ${err.message}` });
    }
  } else if (lower === 'theme dark') {
    if (!systemStore.isDark) systemStore.toggleTheme();
    history.value.push({ type: 'output', text: '已切换为深色外观' });
  } else if (lower === 'theme light') {
    if (systemStore.isDark) systemStore.toggleTheme();
    history.value.push({ type: 'output', text: '已切换为浅色外观' });
  } else if (lower === 'uname -a') {
    history.value.push({
      type: 'output',
      text: 'Darwin Sub2API-Tahoe.local 24.0.0 Darwin Kernel Version 24.0.0; root:xnu-11215.1.1~2/RELEASE_ARM64_T8112 arm64'
    });
  } else {
    history.value.push({
      type: 'error',
      text: `zsh: command not found: ${cmd}. 输入 "help" 获取指令清单。`
    });
  }

  } finally {
    isRunning.value = false;
    scrollToBottom();
  }
}
</script>

<template>
  <div class="user-app-polish terminal-app flex-1 flex flex-col h-full bg-[#1e1e1e] text-[#f0f0f0] font-mono text-xs select-text overflow-hidden">
    <!-- Terminal Header Bar -->
    <div class="terminal-toolbar h-10 px-4 bg-[#2d2d2d] border-b border-black/30 flex items-center justify-between text-[11px] text-gray-400 select-none shrink-0">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
        <span class="text-gray-300">Sub2API · 命令工具</span>
      </div>
      <div class="flex items-center gap-3 min-w-0"><span class="truncate text-[10px] text-gray-500">{{ buildGatewayUrl('/') }}</span><button class="text-xs text-gray-300 shrink-0" @click="history = []" :disabled="isRunning">清屏</button></div>
    </div>

    <!-- Terminal Body -->
    <div ref="terminalBody" class="terminal-output flex-1 min-h-0 p-4 overflow-auto space-y-2 leading-relaxed">
      <div
        v-for="(item, idx) in history"
        :key="idx"
        class="whitespace-pre-wrap break-all"
        :class="{
          'text-gray-400': item.type === 'output',
          'text-emerald-400 font-semibold': item.type === 'input',
          'text-red-400': item.type === 'error'
        }"
      >
        {{ item.text }}
      </div>

      <div v-if="isRunning" class="text-xs text-gray-500" role="status">正在执行…</div>
      <!-- Input Line -->
      <div class="flex items-center gap-1 text-emerald-400 pt-1">
        <span class="shrink-0">sub2api@gateway ~ %</span>
        <input
          v-model="currentInput"
          type="text"
          class="min-w-0 flex-1 bg-transparent border-none outline-none text-gray-100 font-mono text-[13px]" aria-label="命令输入" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="isRunning"
          autofocus
          @keydown.enter="handleCommand" @keydown.up.prevent="recallCommand(-1)" @keydown.down.prevent="recallCommand(1)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-app {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>
