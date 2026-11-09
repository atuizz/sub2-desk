/**
 * 通用 TOTP step-up（sudo）二次验证。
 *
 * 与上游 v0.2.20 `frontend/src/composables/useStepUp.ts` 同语义的 desk 实现：
 * 敏感操作先试一次，后端返回 STEP_UP_REQUIRED 时弹出 TOTP 验证框，
 * 拿到短期授权后透明重试一次。以下情况不弹框、直接抛给调用方处理：
 * STEP_UP_TOTP_NOT_ENABLED（未开启 TOTP）、STEP_UP_ADMIN_API_KEY_FORBIDDEN /
 * STEP_UP_MCP_OAUTH_FORBIDDEN / STEP_UP_MACHINE_CREDENTIAL_FORBIDDEN
 * （机器凭证无法完成验证）。用户取消验证时抛 StepUpCancelledError，
 * 调用方应静默处理，不当作错误提示。
 *
 * 弹框本身由 `components/auth/TotpStepUpSheet.vue` 渲染（调用
 * totpAPI.stepUp 完成验证后调 controller.onVerified()）。
 *
 * 后端语义（internal/server/middleware/step_up.go、handler/mcp_oauth_handler.go）：
 * 管理员写操作始终强制验证（EnforceStepUpAlways，无视全局开关）；
 * 其余门控操作仅在 step_up_enabled 开关开启时强制；开关关闭时直接放行。
 */
import { ref } from 'vue';

/** 后端用于标识 step-up 状态的错误码。 */
const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED';
const STEP_UP_TOTP_NOT_ENABLED = 'STEP_UP_TOTP_NOT_ENABLED';
const STEP_UP_ADMIN_API_KEY_FORBIDDEN = 'STEP_UP_ADMIN_API_KEY_FORBIDDEN';
const STEP_UP_MCP_OAUTH_FORBIDDEN = 'STEP_UP_MCP_OAUTH_FORBIDDEN';
const STEP_UP_MACHINE_CREDENTIAL_FORBIDDEN = 'STEP_UP_MACHINE_CREDENTIAL_FORBIDDEN';

/**
 * 用户取消 TOTP 验证框时由 run() 抛出；调用方应静默处理，不当作错误提示。
 */
export class StepUpCancelledError extends Error {
  readonly code = 'STEP_UP_CANCELLED';
  constructor() {
    super('step-up verification cancelled by user');
    this.name = 'StepUpCancelledError';
  }
}

export function isStepUpCancelled(err: unknown): boolean {
  return err instanceof StepUpCancelledError;
}

interface ApiError {
  status?: number;
  code?: string | number;
  reason?: string;
  message?: string;
}

/** 从 code 或 reason 两种信封形态中提取 STEP_UP* 标记。 */
function markerOf(err: unknown): string {
  const e = (err ?? {}) as ApiError;
  const candidates = [e.code, e.reason].map((v) => (typeof v === 'string' ? v : ''));
  return candidates.find((v) => v.startsWith('STEP_UP')) || '';
}

export function isStepUpRequired(err: unknown): boolean {
  return markerOf(err) === STEP_UP_REQUIRED;
}

export function isStepUpBlocked(err: unknown): boolean {
  const m = markerOf(err);
  return m === STEP_UP_TOTP_NOT_ENABLED
    || m === STEP_UP_ADMIN_API_KEY_FORBIDDEN
    || m === STEP_UP_MCP_OAUTH_FORBIDDEN
    || m === STEP_UP_MACHINE_CREDENTIAL_FORBIDDEN;
}

export function stepUpBlockReason(err: unknown): string {
  return markerOf(err);
}

export type StepUpController = ReturnType<typeof useStepUp>;

export function useStepUp() {
  const visible = ref(false);
  const blockedReason = ref<string>('');
  let resolver: ((ok: boolean) => void) | null = null;
  let pendingPrompt: Promise<boolean> | null = null;

  /** 打开 TOTP 验证框，拿到授权后 resolve true。 */
  function prompt(): Promise<boolean> {
    if (pendingPrompt) return pendingPrompt;
    visible.value = true;
    pendingPrompt = new Promise<boolean>((resolve) => {
      resolver = resolve;
    });
    return pendingPrompt;
  }

  function onVerified() {
    visible.value = false;
    resolver?.(true);
    resolver = null;
    pendingPrompt = null;
  }

  function onCancel() {
    visible.value = false;
    resolver?.(false);
    resolver = null;
    pendingPrompt = null;
  }

  /**
   * 执行敏感操作。后端返回 STEP_UP_REQUIRED 时弹框验证后重试一次；
   * 被拦截类错误直接抛给调用方；用户取消弹框时抛 StepUpCancelledError。
   */
  async function run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err) {
      if (isStepUpBlocked(err)) {
        blockedReason.value = markerOf(err);
        throw err;
      }
      if (!isStepUpRequired(err)) {
        throw err;
      }
      const ok = await prompt();
      if (!ok) {
        throw new StepUpCancelledError();
      }
      // 会话已持有 step-up 授权，重试一次。
      return await action();
    }
  }

  return {
    visible,
    blockedReason,
    prompt,
    onVerified,
    onCancel,
    run
  };
}
