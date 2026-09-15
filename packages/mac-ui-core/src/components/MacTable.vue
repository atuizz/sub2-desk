<script setup lang="ts">
export interface TableColumn {
  key: string;
  label: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
}

const props = defineProps<{
  columns: TableColumn[];
  data: any[];
  rowKey?: string;
}>();

const emit = defineEmits<{
  (e: 'rowClick', item: any): void;
}>();
</script>

<template>
  <div class="w-full h-full overflow-auto flex flex-col bg-[var(--content-bg)]">
    <table class="w-full text-left border-collapse text-[12.5px]">
      <thead class="sticky top-0 z-10 bg-[var(--sidebar-bg)] border-b border-[var(--border-subtle)]">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="px-2.5 py-2 font-semibold text-[var(--text-secondary)] whitespace-nowrap"
            :style="{
              width: col.width || 'auto',
              textAlign: col.align || 'left'
            }"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(item, idx) in data"
          :key="rowKey ? item[rowKey] : idx"
          class="border-b border-[var(--border-subtle)] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors cursor-default"
          :class="idx % 2 === 1 ? 'bg-black/[0.015] dark:bg-white/[0.015]' : ''"
          @click="emit('rowClick', item)"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            class="px-2.5 py-2 whitespace-nowrap text-[var(--text-primary)]"
            :style="{ textAlign: col.align || 'left' }"
          >
            <slot :name="col.key" :row="item">
              {{ item[col.key] }}
            </slot>
          </td>
        </tr>
        <tr v-if="data.length === 0">
          <td
            :colspan="columns.length"
            class="text-center py-12 text-[var(--text-tertiary)] italic"
          >
            暂无数据记录
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
