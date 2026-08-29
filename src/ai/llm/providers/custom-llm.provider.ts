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
 * compatible nào không hiểu key nào sẽ bỏ qua key đó; gửi nhiều biến thể để phủ
 * các họ model (OpenAI, Qwen3, DeepSeek, GLM, Gemini, Claude qua proxy).
 */
const NO_REASONING_KWARGS: Record<string, unknown> = {
  // OpenAI (gpt-5.1+), Gemini, DeepSeek, GLM, và hầu hết proxy (api.b.ai) map
  // key này. Đã kiểm chứng với api.b.ai: `reasoning_effort:"none"` ⇒ 0 reasoning
  // token, không còn xung đột `tool_choice` + thinking.
  reasoning_effort: 'none',
  // vLLM / SGLang phục vụ Qwen3 tự host — proxy không hiểu thì bỏ qua.
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
