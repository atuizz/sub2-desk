import { ref, onUnmounted } from 'vue';
import { totpAPI } from '../../../api/totp';
import { adminError } from '../admin-feedback';

/** Only the official STEP_UP_REQUIRED response may initiate a single retry. */
export function usePluginStepUp() {
  const visible = ref(false), verifying = ref(false), code = ref(''), error = ref('');
  let resolver: ((ok: boolean) => void) | null = null;
  let disposed = false, generation = 0;
  function settle(ok: boolean) { generation++; resolver?.(ok); resolver = null; visible.value = false; code.value = ''; verifying.value = false; }
  async function verify() {
    if (verifying.value || !resolver || disposed) return;
    if (!/^\d{6}$/.test(code.value)) { error.value = '请输入6位动态验证码'; return; }
    const epoch = generation; verifying.value = true; error.value = '';
    try {
      const result = await totpAPI.stepUp(code.value);
      if (epoch !== generation || disposed) return;
      if (!result.verified) throw new Error('身份验证未通过');
      settle(true);
    } catch (err) { if (epoch === generation) error.value = adminError(err, '身份验证失败'); }
    finally { if (epoch === generation) { verifying.value = false; code.value = ''; } }
  }
  async function run<T>(action: () => Promise<T>): Promise<T> {
    if (disposed) throw new Error('插件窗口已关闭');
    try { return await action(); }
    catch (err: any) {
      if (disposed) throw new Error('插件窗口已关闭');
      if (![err?.code, err?.reason].includes('STEP_UP_REQUIRED')) throw err;
      if (resolver) throw new Error('另一项操作正在等待验证');
      visible.value = true; error.value = ''; code.value = '';
      const ok = await new Promise<boolean>(resolve => { resolver = resolve; });
      if (!ok || disposed) throw new Error('操作已取消');
      return await action();
    }
  }
  onUnmounted(() => { disposed = true; settle(false); });
  return { visible, verifying, code, error, verify, run, cancel: () => settle(false) };
}
