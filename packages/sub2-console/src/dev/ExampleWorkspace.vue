<script setup lang="ts">
import { computed, ref } from 'vue';
import { MacButton, MacSheet, MacAlertSheet, MacSearchField, MacSegmented, type WindowInstance } from '@sub2-mac/core';

defineProps<{ win?: WindowInstance }>();
const query = ref('');
const section = ref('all');
const sheet = ref(false);
const confirm = ref(false);
const saving = ref(false);
const name = ref('');
const notice = ref('');
const rows = ref([
  { id: 1, name: '产品设计', kind: '工作区', owner: '设计团队', status: '进行中', updated: '今天 16:42', icon: '/assets/apps.png' },
  { id: 2, name: '界面组件', kind: '组件库', owner: '前端团队', status: '已同步', updated: '今天 14:18', icon: '/assets/developer.png' },
  { id: 3, name: '交互规范', kind: '文档', owner: '设计团队', status: '已同步', updated: '昨天 18:06', icon: '/assets/notes.png' },
  { id: 4, name: '发布检查', kind: '清单', owner: '产品团队', status: '进行中', updated: '昨天 11:32', icon: '/assets/reminders.png' },
]);
const visible = computed(() => rows.value.filter(row => row.name.includes(query.value) && (section.value === 'all' || row.status === '进行中')));
const selected = ref<number | null>(1);
async function save() {
  if (saving.value || !name.value.trim()) return;
  saving.value = true;
  await new Promise(resolve => setTimeout(resolve, 600));
  rows.value.push({ id: Date.now(), name: name.value.trim(), kind: '工作区', owner: '当前用户', status: '进行中', updated: '刚刚', icon: '/assets/apps.png' });
  name.value = ''; saving.value = false; sheet.value = false; notice.value = '已添加到当前预览';
}
function remove() {
  rows.value = rows.value.filter(row => row.id !== selected.value);
  selected.value = null; confirm.value = false; notice.value = '已移除选中的示例项目';
}
</script>

<template>
  <div class="example-workspace">
    <header class="example-toolbar">
      <div><h1>{{ win?.title || '工作空间' }}</h1><p>所有项目 · {{ rows.length }} 个项目</p></div>
      <MacButton variant="primary" @click="sheet = true">新建项目</MacButton>
    </header>
    <div class="example-filters">
      <MacSegmented v-model="section" :options="[{ label: '全部项目', value: 'all' }, { label: '进行中', value: 'active' }]" />
      <MacSearchField v-model="query" placeholder="搜索项目" />
    </div>
    <div class="example-content">
      <table>
        <thead><tr><th>名称</th><th>状态</th><th>所属团队</th><th>修改时间</th></tr></thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id" :class="{ selected: row.id === selected }" @click="selected = row.id" tabindex="0" @keydown.enter="selected = row.id">
            <td><div class="example-name"><img :src="row.icon" alt="" /><div><strong>{{ row.name }}</strong><small>{{ row.kind }}</small></div></div></td>
            <td><span class="example-status" :class="{ active: row.status === '进行中' }">{{ row.status }}</span></td>
            <td>{{ row.owner }}</td><td>{{ row.updated }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!visible.length" class="example-empty">没有匹配的项目</div>
    </div>
    <footer class="example-footer"><span role="status">{{ notice || '示例数据 · 仅用于交互预览' }}</span><MacButton size="sm" :disabled="selected === null" @click="confirm = true">移除项目</MacButton></footer>
    <MacSheet :show="sheet" title="新建项目" @close="sheet = false">
      <label class="example-label" for="example-name">项目名称</label>
      <input id="example-name" v-model="name" class="example-input" placeholder="例如：设计资源" maxlength="60" />
      <p class="example-help">项目仅保存在当前预览中，不会写入业务后端。</p>
      <template #footer><MacButton :disabled="saving" @click="sheet = false">取消</MacButton><MacButton variant="primary" :loading="saving" :disabled="!name.trim()" @click="save">创建项目</MacButton></template>
    </MacSheet>
    <MacAlertSheet :show="confirm" title="移除这个项目？" message="此操作仅修改当前示例列表。" confirm-text="移除项目" danger @confirm="remove" @cancel="confirm = false" />
  </div>
</template>

<style scoped>
.example-workspace { display:flex; flex:1; min-height:0; flex-direction:column; background:var(--window-bg-solid); color:var(--text-primary); font-size:13px; }
.example-toolbar { padding:22px 24px 18px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
h1 { font-size:21px; font-weight:650; letter-spacing:-.6px; } .example-toolbar p { color:var(--text-tertiary); font-size:12px; margin-top:5px; }
.example-filters { padding:0 24px 18px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.example-content { flex:1; overflow:auto; margin:0 18px; border:1px solid var(--border-color); border-radius:10px; background:var(--bg-surface); }
table { width:100%; min-width:540px; border-collapse:collapse; text-align:left; } th { font-weight:500; font-size:11px; color:var(--text-tertiary); padding:11px 15px; background:var(--bg-surface-subtle); }
td { padding:13px 15px; border-top:1px solid var(--border-subtle); font-size:12px; color:var(--text-secondary); white-space:nowrap; }
tbody tr { cursor:default; } tbody tr:hover { background:var(--bg-surface-subtle); } tbody tr.selected { background:rgba(0,122,255,.07); }
.example-name { display:flex; align-items:center; gap:12px; } .example-name img { width:34px; height:34px; object-fit:contain; } strong { font-size:13px; font-weight:550; color:var(--text-primary); } small { display:block; color:var(--text-tertiary); margin-top:3px; font-size:11px; }
.example-status { display:inline-flex; align-items:center; gap:6px; font-size:11px; } .example-status::before { content:''; width:5px; height:5px; border-radius:50%; background:#38a66b; } .example-status.active::before { background:#d19a3d; }
.example-footer { min-height:52px; padding:10px 22px; display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:11px; color:var(--text-tertiary); } .example-empty { text-align:center; padding:60px 10px; color:var(--text-tertiary); }
.example-label { display:block; font-size:12px; font-weight:600; margin-bottom:8px; } .example-input { width:100%; height:35px; border-radius:7px; border:1px solid var(--border-color); background:var(--bg-surface); padding:0 10px; outline:none; } .example-input:focus { border-color:var(--accent); box-shadow:var(--focus-ring); } .example-help { font-size:11px; color:var(--text-tertiary); margin-top:12px; line-height:1.6; }
@media(max-width:640px) { .example-toolbar { padding:18px 15px; } .example-filters { padding:0 15px 14px; flex-wrap:wrap; gap:10px; } .example-content { margin:0 10px; } .example-footer { padding:10px 14px; } }
</style>
