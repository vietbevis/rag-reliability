import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig } from '../../../config/configuration';
import { LlmProvider } from '../llm-provider.enum';
import type { LLMOptions } from '../llm.interface';
import { BaseLangChainLlmProvider } from './base-langchain-llm.provider';

/**
 * Tham số body gửi kèm để TẮT chế độ "thinking"/reasoning. Endpoint OpenAI-
 * compatible nào không hiểu key nào sẽ bỏ qua key đó.
 *
 * LỊCH SỬ: từng gửi `reasoning_effort:'none'` — api.b.ai (2026-09) đã đổi, giờ
 * validate chặt và chỉ nhận `low|medium|high|xhigh|max`, gửi `'none'` ⇒ HTTP
 * 400. Bỏ hẳn key này; `enable_thinking:false` (vLLM/SGLang/DeepSeek) đủ để tắt
 * thinking cho các model đang dùng và không bị endpoint nào từ chối.
 */
const NO_REASONING_KWARGS: Record<string, unknown> = {
  enable_thinking: false,
};

/**
 * Bất kỳ endpoint nào tương thích OpenAI (vLLM, Ollama, LiteLLM, tự host, …).
 * Dùng client OpenAI trỏ tới `CUSTOM_LLM_BASE_URL` (PROMPT §4.4).
 */
@Injectable()
export class CustomLlmProvider extends BaseLangChainLlmProvider {
  readonly provider = LlmProvider.CUSTOM;

  private readonly custom: AppConfig['llm']['custom'];

  constructor(config: ConfigService<AppConfig, true>) {
    const llm = config.get('llm', { infer: true });
    super({
      timeoutMs: llm.timeoutMs,
      maxRetries: llm.maxRetries,
      retryBaseDelayMs: llm.retryBaseDelayMs,
    });
    this.custom = llm.custom;
  }

  get defaultModel(): string {
    return this.custom.model ?? 'custom-model';
  }

  protected resolveModelName(options?: LLMOptions): string {
    return options?.model ?? this.custom.model ?? 'custom-model';
  }

  protected getModel(options?: LLMOptions): BaseChatModel | null {
    if (!this.custom.baseUrl || !this.custom.model) return null;
    return new ChatOpenAI({
      apiKey: this.custom.apiKey ?? 'not-required',
      model: this.resolveModelName(options),
      temperature: options?.temperature ?? 0,
      maxTokens: options?.maxTokens,
      timeout: options?.timeoutMs ?? this.cfg.timeoutMs,
      maxRetries: 0,
      configuration: { baseURL: this.custom.baseUrl },
      ...(options?.reasoning === false
        ? { modelKwargs: NO_REASONING_KWARGS }
        : {}),
    });
  }
}
