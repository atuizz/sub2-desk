<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { MacButton } from '@sub2-mac/core';
import { getSetupStatus, testDatabase, testRedis, install, type InstallRequest } from '../api/setup';
const form = reactive<InstallRequest>({
  database: { host: 'localhost', port: 5432, user: 'postgres', password: '', dbname: 'sub2api', sslmode: 'disable' },
  redis: { host: 'localhost', port: 6379, username: '', password: '', db: 0, enable_tls: false },
  admin: { email: '', password: '' }, server: { host: '0.0.0.0', port: 8000, mode: 'release' },
});
const steps = ['数据库', 'Redis', '管理员', '确认安装'];
const step = ref(0), status = ref<'loading'|'needed'|'installed'|'error'>('loading');
const error = ref(''), busy = ref(false), confirmPassword = ref('');
const dbTest = ref(''), redisTest = ref(''), submitted = ref(false), accepted = ref(false), ready = ref(false);
const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let disposed = false; let attempts = 0;
const dbReady = computed(() => dbTest.value === JSON.stringify(form.database));
const redisReady = computed(() => redisTest.value === JSON.stringify(form.redis));
const portValid = (v: number) => Number.isInteger(v) && v > 0 && v <= 65535;
const adminReady = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.admin.email) && form.admin.password.length >= 8 && form.admin.password === confirmPassword.value);
const canNext = computed(() => step.value === 0 ? dbReady.value : step.value === 1 ? redisReady.value : adminReady.value);
function message(e: unknown) { return e instanceof Error ? e.message : '请求失败，请重试'; }
async function checkStatus() {
  if (busy.value) return;
  status.value = 'loading'; error.value = '';
  try { const data = await getSetupStatus(controller.signal); if (!disposed) status.value = data.needs_setup ? 'needed' : 'installed'; }
  catch(e) { if (!disposed) { status.value = 'error'; error.value = message(e); } }
}
async function test(kind: 'database'|'redis') {
  if (busy.value || status.value !== 'needed' || submitted.value) return;
  const value = form[kind];
  if (!value.host.trim() || !portValid(value.port) || (kind === 'database' && (!form.database.user.trim() || !form.database.dbname.trim())) || (kind === 'redis' && (!Number.isInteger(form.redis.db) || form.redis.db < 0))) { error.value = '请填写有效的主机、端口及连接参数'; return; }
  busy.value = true; error.value = ''; const snapshot = JSON.stringify(value);
  try {
    if (kind === 'database') { dbTest.value = ''; await testDatabase(JSON.parse(snapshot), controller.signal); if (!disposed) dbTest.value = snapshot; }
    else { redisTest.value = ''; await testRedis(JSON.parse(snapshot), controller.signal); if (!disposed) redisTest.value = snapshot; }
  } catch(e) { if (!disposed) error.value = message(e); }
  finally { if (!disposed) busy.value = false; }
}
async function poll() {
  if (disposed || ready.value) return;
  attempts++;
  try { const data = await getSetupStatus(controller.signal); if (!disposed && !data.needs_setup) { ready.value = true; error.value = ''; return; } }
  catch { /* Restart may temporarily close the listener. */ }
  if (disposed) return;
  if (attempts < 30) timer = setTimeout(poll, 2000);
  else error.value = '尚未确认服务就绪，请稍后重新检查。不要重复安装。';
}
function retryReadiness() { if (timer) clearTimeout(timer); attempts = 0; error.value = ''; void poll(); }
async function submit() {
  if (busy.value || submitted.value || status.value !== 'needed' || !dbReady.value || !redisReady.value || !adminReady.value) return;
  if (!form.server.host.trim() || !portValid(form.server.port)) { error.value = '请填写有效的后端监听地址和端口'; return; }
  busy.value = true; error.value = '';
  try {
    const current = await getSetupStatus(controller.signal);
    if (!current.needs_setup) { status.value = 'installed'; return; }
    submitted.value = true;
    const snapshot = JSON.parse(JSON.stringify(form));
    await install(snapshot, controller.signal);
    accepted.value = true;
  } catch(e) { if (!disposed) error.value = message(e); }
  finally {
    if (!disposed) {
      busy.value = false;
      if (submitted.value) {
        form.database.password = ''; form.redis.password = ''; form.admin.password = ''; confirmPassword.value = ''; dbTest.value = ''; redisTest.value = '';
        timer = setTimeout(poll, 2000);
      }
    }
  }
}
onMounted(checkStatus);
onUnmounted(() => { disposed = true; controller.abort(); if (timer) clearTimeout(timer); form.database.password = ''; form.redis.password = ''; form.admin.password = ''; });
</script>
<template>
  <main class="setup-page"><section class="setup-window">
    <header><img src="/favicon.svg" alt="" /><div><h1>设置 Sub2API</h1><p>连接数据库、缓存并创建管理员。</p></div></header>
    <p v-if="status === 'loading'" role="status">正在检查安装状态…</p>
    <div v-else-if="status === 'installed'"><h2>服务已完成安装</h2><p>可以使用现有账号登录。</p><a href="/login">前往登录</a></div>
    <div v-else-if="submitted"><h2>{{ ready ? '服务已就绪' : accepted ? '安装已提交，正在等待服务就绪' : '正在确认安装结果' }}</h2><p>配置已发送。页面不会重复提交安装。</p><a v-if="ready" href="/login">前往登录</a><MacButton v-else :disabled="busy" @click="retryReadiness">重新检查状态</MacButton></div>
    <template v-else-if="status === 'needed'">
      <ol><li v-for="(name,index) in steps" :key="name" :aria-current="step === index ? 'step' : undefined" :class="{active:step===index}">{{ index+1 }}. {{ name }}</li></ol>
      <form @submit.prevent="step===3 ? submit() : canNext && step++">
        <fieldset :disabled="busy">
          <h2>{{ steps[step] }}</h2>
          <div v-if="step===0" class="fields">
            <label>主机<input v-model="form.database.host" required /></label><label>端口<input v-model.number="form.database.port" type="number" min="1" max="65535" required /></label>
            <label>用户名<input v-model="form.database.user" required /></label><label>密码<input v-model="form.database.password" type="password" autocomplete="off" /></label>
            <label>数据库名<input v-model="form.database.dbname" required /></label><label>SSL 模式<select v-model="form.database.sslmode"><option v-for="mode in ['disable','require','verify-ca','verify-full']" :key="mode">{{ mode }}</option></select></label>
            <MacButton @click="test('database')">{{ dbReady ? '连接已验证' : '测试数据库连接' }}</MacButton>
          </div>
          <div v-if="step===1" class="fields">
            <label>主机<input v-model="form.redis.host" required /></label><label>端口<input v-model.number="form.redis.port" type="number" min="1" max="65535" required /></label>
            <label>用户名（可选）<input v-model="form.redis.username" /></label><label>密码（可选）<input v-model="form.redis.password" type="password" autocomplete="off" /></label>
            <label>数据库编号<input v-model.number="form.redis.db" type="number" min="0" required /></label><label class="check"><input v-model="form.redis.enable_tls" type="checkbox" />启用 TLS</label>
            <MacButton @click="test('redis')">{{ redisReady ? '连接已验证' : '测试 Redis 连接' }}</MacButton>
          </div>
          <div v-if="step===2" class="fields">
            <label class="wide">管理员邮箱<input v-model="form.admin.email" type="email" autocomplete="username" required /></label>
            <label>密码（至少8位）<input v-model="form.admin.password" type="password" minlength="8" autocomplete="new-password" required /></label>
            <label>确认密码<input v-model="confirmPassword" type="password" minlength="8" autocomplete="new-password" required /></label>
          </div>
          <div v-if="step===3"><p>数据库：{{ form.database.host }}:{{ form.database.port }} / {{ form.database.dbname }}</p><p>Redis：{{ form.redis.host }}:{{ form.redis.port }}</p><p>管理员：{{ form.admin.email }}</p>
            <div class="fields"><label>后端监听地址<input v-model="form.server.host" required /></label><label>后端监听端口<input v-model.number="form.server.port" type="number" min="1" max="65535" required /></label><label>运行模式<select v-model="form.server.mode"><option value="release">生产</option><option value="debug">调试</option></select></label></div>
            <p>点击“安装”将初始化数据库、创建管理员并保存配置，服务可能重启。代理端口应与后端监听端口一致。</p>
          </div>
        </fieldset>
        <footer><MacButton v-if="step>0" :disabled="busy" @click="step--">上一步</MacButton><MacButton v-if="step<3" :disabled="busy || !canNext" @click="step++">下一步</MacButton><MacButton v-else variant="primary" :loading="busy" :disabled="!dbReady || !redisReady || !adminReady" @click="submit">安装</MacButton></footer>
      </form>
    </template>
    <p v-if="error" role="alert" class="error">{{ error }}</p><MacButton v-if="status==='error'" @click="checkStatus">重新读取</MacButton>
  </section></main>
</template>
<style scoped>
.setup-page{min-height:100vh;padding:32px 16px;display:grid;place-items:center;background:var(--bg-primary,#f2f3f5);color:var(--text-primary,#202124)}.setup-window{width:min(100%,680px);padding:28px;border:1px solid var(--border-subtle,#ddd);border-radius:18px;background:var(--bg-secondary,#fff);box-shadow:0 16px 60px #0001}header{display:flex;gap:14px;align-items:center;margin-bottom:24px}header img{width:48px;height:48px}h1{font-size:22px;font-weight:600}h2{font-size:17px;font-weight:600;margin-bottom:16px}p{font-size:13px;line-height:1.7;margin:10px 0}ol{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0;font-size:12px}li.active{color:#007aff;font-weight:600}fieldset{border:0;min-width:0}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.fields label{display:grid;gap:6px;font-size:13px}.fields input,.fields select{width:100%;min-width:0;border:1px solid var(--border-subtle,#ccc);border-radius:7px;padding:8px;background:var(--bg-primary,#fff);color:inherit}.fields .check{display:flex;align-items:center}.check input{width:auto}.wide{grid-column:1/-1}footer{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}.error{color:#c43535;overflow-wrap:anywhere}a{color:#007aff}input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid #007aff;outline-offset:2px}@media(max-width:480px){.fields{grid-template-columns:1fr}.setup-window{padding:20px}.setup-page{padding:12px}}
</style>
