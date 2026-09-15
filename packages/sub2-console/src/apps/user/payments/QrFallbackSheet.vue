<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import { paymentAPI } from '@/api/payment';
import type { CreateOrderRequest, CreateOrderResult } from '@/types/payment';
import { qrPayload, requestFromOrder } from './qrFallback';
import { paymentKind } from './flow';
const props = defineProps<{ show: boolean; orderId?: number; request?: CreateOrderRequest; paymentType: string }>();
const emit = defineEmits<{ close: []; created: [order: CreateOrderResult, request: CreateOrderRequest]; changed: [] }>();
const busy = ref(false), issue = ref(''), creationStarted = ref(false);
let generation = 0, alive = true;
watch(() => [props.orderId, props.request], () => { generation++; issue.value = ''; creationStarted.value = false; busy.value = false; });
async function create() {
  if (!props.show || busy.value || creationStarted.value) return;
  const current = generation; busy.value = true; issue.value = '';
  const active = () => alive && current === generation && props.show;
  try {
    let request = props.request;
    if (props.orderId) {
      const { data: original } = await paymentAPI.getOrder(props.orderId);
      if (!active()) return;
      // Validate business context before cancelling an existing order.
      request = requestFromOrder(original, props.paymentType);
      qrPayload(request, window.location.origin);
      if (original.status === 'PENDING') {
        await paymentAPI.cancelOrder(props.orderId);
        if (!active()) return;
        const { data: afterCancel } = await paymentAPI.getOrder(props.orderId);
        if (!active()) return;
        if (afterCancel.status !== 'CANCELLED') throw new Error('原订单尚未确认取消，不会新建订单，请查询原订单结果');
      } else if (!['CANCELLED', 'EXPIRED', 'FAILED'].includes(original.status)) {
        throw new Error('原订单已支付或正在处理，不会新建订单，请查询原订单结果');
      }
    }
    if (!request) throw new Error('缺少原下单信息，请返回钱包重新选择');
    const payload = qrPayload(request, window.location.origin);
    if (!active()) return;
    creationStarted.value = true; // Ambiguous POST failure must not be retried blindly, even after closing/reopening.
    const { data } = await paymentAPI.createOrder(payload);
    if (!active()) return;
    const result = { ...data, payment_type: data.payment_type || props.paymentType };
    // Keep every created order visible, including providers that ignore the QR request.
    emit('created', result, payload);
    if (paymentKind(result) !== 'qr' || !result.qr_code) issue.value = '支付服务未返回二维码，新订单已保留，请查询或选择当前可用入口';
    emit('close');
  } catch (error) {
    if (active()) issue.value = creationStarted.value
      ? '新订单提交结果不确定，为避免重复下单已停止重试，请返回钱包订单记录查询'
      : error && typeof error === 'object' && 'message' in error ? String(error.message) : '无法切换到扫码支付，请查询原订单后重试';
  } finally { if (alive && current === generation) { busy.value = false; emit('changed'); } }
}
onBeforeUnmount(() => { alive = false; generation++; });
</script>
<template>
  <MacSheet :show="show" title="改用二维码支付" :loading="busy" @close="emit('close')">
    <p class="fallback-description">{{ orderId ? `将先取消原订单 #${orderId}，确认取消后再新建二维码订单。请勿继续支付原订单。若原订单已支付或正在入账，将停止新建。` : '将按本次选择新建一笔二维码支付订单。上一次下单未返回订单编号，请先确认订单记录中没有正在付款的订单。' }}</p>
    <p v-if="issue" role="alert" class="fallback-error">{{ issue }}</p>
    <template #footer><MacButton :disabled="busy" @click="emit('close')">返回</MacButton><MacButton variant="primary" :loading="busy" :disabled="creationStarted" @click="create">{{ orderId ? '取消原订单并新建' : '新建二维码订单' }}</MacButton></template>
  </MacSheet>
</template>
<style scoped>.fallback-description,.fallback-error{font-size:13px;line-height:1.8;overflow-wrap:anywhere}.fallback-error{color:var(--danger);margin-top:12px}</style>
