<script setup lang="ts">
import { ref } from 'vue';
import { MacButton, useWindowManager } from '@sub2-mac/core';
import { buildGatewayUrl } from '@/api/url';
import './app-polish.css';
import type { WindowInstance } from '@sub2-mac/core';

defineProps<{
  win?: WindowInstance;
}>();

const currentTab = ref(0);
const wm = useWindowManager();
const tabs = [
  { title: 'API 接口技术规范', url: buildGatewayUrl('/v1/chat/completions') },
  { title: '批量生图指南', url: buildGatewayUrl('/docs/batch-image') },
  { title: '网关状态与错误码', url: buildGatewayUrl('/docs/errors') }
];

const docSections = [
  { id: 'chat', title: '对话补全 /v1/chat/completions', tag: 'POST' },
  { id: 'models', title: '模型列表 /v1/models', tag: 'GET' },
  { id: 'batch', title: '批量生图规范', tag: 'IMAGE' },
  { id: 'stream', title: 'SSE 流式推送规范', tag: 'SSE' },
  { id: 'errors', title: 'HTTP 状态码与故障排查', tag: 'ERR' }
];

const activeSection = ref('chat');
</script>

<template>
  <div class="user-app-polish safari-app flex-1 flex flex-col h-full bg-[#f6f6f8] dark:bg-[#1e1e20] text-[#1d1d1f] dark:text-[#f5f5f7] select-text font-sans overflow-hidden">
    <!-- Safari Toolbar -->
    <div class="app-toolbar h-11 px-3 bg-white/80 dark:bg-[#28282b]/80 backdrop-blur-md border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-3 select-none shrink-0 z-10">
      <!-- Left Controls -->
      <div class="flex items-center gap-1">
        <button :disabled="currentTab === 0" aria-label="上一个文档标签" @click="currentTab--; activeSection = currentTab === 1 ? 'batch' : 'chat'" class="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button :disabled="currentTab === tabs.length - 1" aria-label="下一个文档标签" @click="currentTab++; activeSection = currentTab === 1 ? 'batch' : 'errors'" class="w-6 h-6 rounded flex items-center justify-center text-gray-400">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <!-- Address Bar Capsule -->
      <div class="flex-1 max-w-[560px] h-7 px-3 rounded-lg bg-black/[0.05] dark:bg-white/[0.08] border border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between text-xs shadow-2xs">
        <div class="flex items-center gap-2 text-gray-400 flex-1 truncate">
          <svg class="w-3 h-3 text-emerald-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <span class="font-mono text-[11.5px] text-gray-900 dark:text-gray-100 truncate select-all">
            {{ tabs[currentTab].url }}
          </span>
        </div>
        <span class="text-[10px] text-gray-400 font-mono">接口文档</span>
      </div>

      <div class="w-12"></div>
    </div>

    <!-- Safari Tabs Bar -->
    <div class="doc-tabs h-7 px-2 bg-gray-100/70 dark:bg-[#252528]/70 flex items-center gap-1 border-b border-black/[0.06] dark:border-white/[0.08] select-none text-xs shrink-0">
      <button type="button"
        v-for="(tab, idx) in tabs"
        :key="idx"
        class="h-6 px-3 rounded-t-md flex items-center gap-2 cursor-pointer transition-colors text-xs"
        :class="currentTab === idx ? 'bg-white dark:bg-[#1e1e20] font-medium shadow-2xs text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:bg-black/5 dark:hover:bg-white/5'"
        @click="currentTab = idx; activeSection = idx === 0 ? 'chat' : idx === 1 ? 'batch' : 'errors'"
      >
        <span class="w-1.5 h-1.5 rounded-full" :class="currentTab === idx ? 'bg-blue-500' : 'bg-transparent'"></span>
        <span class="truncate max-w-[140px]">{{ tab.title }}</span>
      </button>
    </div>

    <!-- Safari Main Body -->
    <div class="doc-layout flex-1 flex min-h-0 overflow-hidden">
      <!-- Left Doc Nav Sidebar -->
      <div class="app-sidebar w-56 p-3 bg-gray-50/70 dark:bg-[#252528]/70 border-r border-black/[0.06] dark:border-white/[0.08] overflow-y-auto select-none shrink-0">
        <div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-2">
          Sub2API 接口文档
        </div>
        <div class="space-y-0.5">
          <button type="button"
            v-for="sec in docSections"
            :key="sec.id"
            class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between cursor-pointer transition-colors"
            :class="activeSection === sec.id ? 'bg-blue-500 text-white font-medium shadow-2xs' : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5'"
            @click="activeSection = sec.id"
          >
            <span class="truncate text-[11.5px]">{{ sec.title }}</span>
            <span class="text-[9px] px-1 py-0.5 rounded font-mono font-bold"
              :class="activeSection === sec.id ? 'bg-white/20 text-white' : 'bg-black/5 dark:bg-white/10 text-gray-500'">
              {{ sec.tag }}
            </span>
          </button>
        </div>
      </div>

      <!-- Main Doc Viewer -->
      <div class="doc-viewer app-content flex-1 p-6 overflow-y-auto bg-white/70 dark:bg-[#1e1e20]/70">
        <div class="max-w-3xl mx-auto space-y-6">
          <!-- 1. Chat completions -->
          <div v-if="activeSection === 'chat'" class="space-y-4">
            <div class="border-b border-black/[0.06] dark:border-white/[0.08] pb-4">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold">POST</span>
                <span class="font-mono text-sm font-semibold text-gray-900 dark:text-white">/v1/chat/completions</span>
              </div>
              <h1 class="text-lg font-bold tracking-tight text-gray-900 dark:text-white">对话补全与流式生成</h1>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                完全兼容 OpenAI 与 Claude 协议规范的高性能模型调用端点，支持双向 SSE 流式响应与函数调用 (Tool Calls)。
              </p>
            </div>

            <div>
              <div class="text-xs font-semibold mb-1.5 text-gray-700 dark:text-gray-300">cURL 调用示例</div>
              <pre class="p-4 rounded-xl bg-gray-900 text-gray-100 font-mono text-xs leading-relaxed overflow-x-auto shadow-sm"><code>curl {{ buildGatewayUrl('/v1/chat/completions') }} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-YOUR_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello Sub2API!"}
    ],
    "stream": true
  }'</code></pre>
            </div>

            <div>
              <div class="text-xs font-semibold mb-1.5 text-gray-700 dark:text-gray-300">JSON 响应结构</div>
              <pre class="p-4 rounded-xl bg-gray-100 dark:bg-[#2c2c2e] text-gray-800 dark:text-gray-200 font-mono text-xs leading-relaxed border border-black/5 dark:border-white/5"><code>{
  "id": "chatcmpl-live",
  "object": "chat.completion",
  "created": 1725434000,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! Sub2API is running on macOS Native Web UI."
      },
      "finish_reason": "stop"
    }
  ]
}</code></pre>
            </div>
          </div>

          <!-- 2. Models list -->
          <div v-else-if="activeSection === 'models'" class="space-y-4">
            <div class="border-b border-black/[0.06] dark:border-white/[0.08] pb-4">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-mono font-bold">GET</span>
                <span class="font-mono text-sm font-semibold text-gray-900 dark:text-white">/v1/models</span>
              </div>
              <h1 class="text-lg font-bold tracking-tight text-gray-900 dark:text-white">获取可用模型列表</h1>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                按当前请求所用 API 密钥绑定的分组，列出所有已启用且通过健康检查的模型清单。
              </p>
            </div>

            <div>
              <div class="text-xs font-semibold mb-1.5 text-gray-700 dark:text-gray-300">cURL 示例</div>
              <pre class="p-4 rounded-xl bg-gray-900 text-gray-100 font-mono text-xs leading-relaxed overflow-x-auto shadow-sm"><code>curl {{ buildGatewayUrl('/v1/models') }} \
  -H "Authorization: Bearer sk-YOUR_API_KEY"</code></pre>
            </div>
          </div>

          <!-- 3. Batch image guide -->
          <div v-else-if="activeSection === 'batch'" class="space-y-4">
            <div class="border-b border-black/[0.06] dark:border-white/[0.08] pb-4">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 text-xs font-mono font-bold">DOCS</span>
                <span class="font-mono text-sm font-semibold text-gray-900 dark:text-white">/docs/batch-image</span>
              </div>
              <h1 class="text-lg font-bold tracking-tight text-gray-900 dark:text-white">批量生图助手指南</h1>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                使用已开启批量生图能力的 Gemini 分组密钥，创建任务、查看进度并下载结果。可选模型以服务端返回为准。
              </p>
            </div>

            <div class="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-300 space-y-2">
              <p class="font-semibold">使用指南说明：</p>
              <p>提交到 /v1/images/batches 后，在批量生图应用中查看任务明细、取消任务或下载结果。单个任务最多生成200张。</p>
              <MacButton @click="wm?.openApp('batch_image')">打开批量生图</MacButton>
            </div>
          </div>

          <!-- 4. SSE Stream -->
          <div v-else-if="activeSection === 'stream'" class="space-y-4">
            <div class="border-b border-black/[0.06] dark:border-white/[0.08] pb-4">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-mono font-bold">EVENT</span>
                <span class="font-mono text-sm font-semibold text-gray-900 dark:text-white">Server-Sent Events</span>
              </div>
              <h1 class="text-lg font-bold tracking-tight text-gray-900 dark:text-white">SSE 流式推送规范</h1>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                响应采用 text/event-stream 格式，每片数据以 data: 封装，结束标识为 data: [DONE]。
              </p>
            </div>
          </div>

          <!-- 5. Error codes -->
          <div v-else class="space-y-4">
            <div class="border-b border-black/[0.06] dark:border-white/[0.08] pb-4">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-mono font-bold">ERR</span>
                <span class="font-mono text-sm font-semibold text-gray-900 dark:text-white">HTTP 状态码表</span>
              </div>
              <h1 class="text-lg font-bold tracking-tight text-gray-900 dark:text-white">HTTP 状态码与故障排查</h1>
            </div>

            <table class="app-table w-full text-xs border-collapse">
              <thead>
                <tr class="border-b border-black/10 dark:border-white/10 text-left text-gray-400 font-medium">
                  <th class="py-2">状态码</th>
                  <th class="py-2">含义</th>
                  <th class="py-2">排查建议</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-black/5 dark:divide-white/5">
                <tr>
                  <td class="py-2 font-mono text-amber-500">401 Unauthorized</td>
                  <td class="py-2">密钥无效或已过期</td>
                  <td class="py-2 text-gray-500">在「钥匙串访问」中检查并复制有效 API 密钥</td>
                </tr>
                <tr>
                  <td class="py-2 font-mono text-amber-500">402 Payment Required</td>
                  <td class="py-2">账户余额不足或额度耗尽</td>
                  <td class="py-2 text-gray-500">进入「钱包」或「卡券包」进行充值兑换</td>
                </tr>
                <tr>
                  <td class="py-2 font-mono text-red-500">429 Too Many Requests</td>
                  <td class="py-2">触发并发限制或频率阈值</td>
                  <td class="py-2 text-gray-500">降低请求速率，或购买更高并发订阅包</td>
                </tr>
                <tr>
                  <td class="py-2 font-mono text-red-500">502 / 529 Upstream Error</td>
                  <td class="py-2">上游 AI 模型提供商过载</td>
                  <td class="py-2 text-gray-500">Sub2API 会自动故障转移到备份渠道</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.safari-app {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
</style>
