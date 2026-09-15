<script setup lang="ts">
defineProps<{ record: object }>();
const labels: Record<string, string> = {
  queue_depth: '待写入队列深度', queue_capacity: '队列容量', dropped_count: '丢弃日志数', write_failed_count: '写入失败数', written_count: '已写入数', avg_write_delay_ms: '平均写入延迟（毫秒）', last_error: '最近错误',
  current_in_use:'当前并发占用',max_capacity:'最大并发容量',load_percentage:'负载百分比',waiting_in_queue:'排队数量',is_available:'是否可用',is_rate_limited:'是否限流',rate_limit_reset_at:'限流恢复时间',rate_limit_remaining_sec:'限流剩余秒数',is_overloaded:'是否过载',overload_until:'过载恢复时间',overload_remaining_sec:'过载剩余秒数',has_error:'是否异常',error_message:'异常原因',username:'用户名',
  id: '记录编号', created_at: '记录时间', fired_at: '触发时间', resolved_at: '解决时间', request_id: '请求 ID', client_request_id: '客户端请求 ID',
  status: '状态', resolved: '是否已解决', kind: '请求类型', status_code: 'HTTP 状态码', level: '日志级别', severity: '严重级别',
  message: '消息', error: '错误原因', error_body: '错误响应正文', request_body: '请求正文（后端脱敏）',
  user_id: '用户 ID', user_email: '用户邮箱', api_key_id: '密钥 ID', api_key_name: '密钥名称', group_id: '分组 ID', group_name: '分组名称',
  account_id: '账号 ID', account_name: '账号名称', platform: '平台', model: '模型', provider: '服务商', host: '主机', component: '组件',
  phase: '错误阶段', type: '错误类型', error_owner: '责任方', error_source: '错误来源',
  user_agent: '客户端标识', client_ip: '客户端 IP', actor_email: '操作者邮箱', actor_user_id: '操作者 ID', actor_role: '操作者角色',
  method: '请求方法', path: '请求路径', request_path: '请求路径', endpoint: '请求入口', ingress: '请求入口', auth_method: '认证方式', credential_masked: '脱敏凭据',
  action: '处理动作', mode: '审核模式', flagged: '是否命中', highest_category: '最高风险分类', highest_score: '最高风险分数',
  matched_keyword: '命中关键词', category_scores: '分类分数', threshold_snapshot: '判定时阈值', input_excerpt: '输入摘要',
  violation_count: '累计违规次数', auto_banned: '是否自动封禁', email_sent: '是否已发邮件', user_status: '用户状态', queue_delay_ms: '排队耗时（毫秒）',
  prompt_preview: '脱敏提示词摘要', prompt_sha256: '提示词摘要哈希', full_prompt: '完整提示词', decision: '审核判定', risk_level: '风险等级', categories: '风险分类',
  latency_ms: '耗时（毫秒）', duration_ms: '请求时长（毫秒）', upstream_latency_ms: '上游耗时（毫秒）',
  title: '标题', description: '说明', metric_value: '触发值', threshold_value: '阈值', rule_id: '规则 ID', dimensions: '触发范围',
  requested_model: '请求模型', upstream_model: '上游模型', inbound_endpoint: '入站入口', upstream_endpoint: '上游入口',
  upstream_status_code: '上游状态码', upstream_error_message: '上游错误消息', upstream_error_detail: '上游错误详情', upstream_errors: '上游尝试记录',
  extra: '补充信息', stream: '是否流式请求',
};
function format(value: unknown) { return value == null ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value); }
</script>
<template><dl class="record-details select-text"><div v-for="(value, key) in record" :key="key"><dt>{{ labels[String(key)] || key }}</dt><dd><pre>{{ format(value) }}</pre></dd></div></dl></template>
<style scoped>.record-details { display: grid; gap: 14px; min-width: 0; }.record-details dt { font-size: 12px; font-weight: 600; color: var(--text-secondary); }.record-details dd { margin: 4px 0 0; min-width: 0; }.record-details pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; font-family: inherit; }</style>
