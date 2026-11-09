<template>
  <div
    v-if="state"
    class="flex flex-wrap items-center gap-1 text-[10px]"
    data-testid="auto-reset-credit-state"
  >
    <!--
      与上游 OpenAIQuotaResetCell.vue 的 autoResetState 区块同行布局：
      仅 OpenAI OAuth 账号、且 extra.auto_reset_credit_enabled === true 时展示。
      开关与 5h/7d 阈值的编辑入口在 platform-controls.ts，不在此组件。
    -->
    <span
      class="inline-flex items-center rounded px-1.5 py-0.5 font-medium"
      :class="stateClass"
    >
      {{ stateLabel }}
      <span v-if="state.trigger_window" class="ml-1 tabular-nums">
        {{ state.trigger_window }}
      </span>
    </span>
    <span v-if="state.checked_at" class="text-gray-500 dark:text-gray-400">
      {{ formatResetCreditExpiry(state.checked_at, 'short') }}
    </span>
    <span
      v-if="state.error_code"
      class="max-w-full truncate text-red-600 dark:text-red-400"
      :title="state.error_code"
    >
      {{ state.error_code }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Account } from '@/types'
import {
  resolveAutoResetCreditState,
  AUTO_RESET_CREDIT_STATUS_LABELS,
  autoResetCreditStateClass,
  formatResetCreditExpiry,
} from './autoResetCreditState'

const props = defineProps<{ account: Account }>()

const state = computed(() => resolveAutoResetCreditState(props.account))
const stateLabel = computed(() =>
  state.value?.status ? AUTO_RESET_CREDIT_STATUS_LABELS[state.value.status] : '',
)
const stateClass = computed(() =>
  state.value?.status ? autoResetCreditStateClass(state.value.status) : '',
)
</script>
