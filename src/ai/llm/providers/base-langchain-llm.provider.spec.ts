import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { LlmError } from '../../../common/errors';
import { LlmProvider } from '../llm-provider.enum';
import type { LLMOptions } from '../llm.interface';
import {
  BaseLangChainLlmProvider,
  messageContentToString,
} from './base-langchain-llm.provider';

class FakeProvider extends BaseLangChainLlmProvider {
  readonly provider = LlmProvider.OPENAI;
  readonly defaultModel = 'fake-model';
  constructor(private readonly model: BaseChatModel | null) {
    super({ timeoutMs: 1000, maxRetries: 1, retryBaseDelayMs: 1 });
  }
  protected getModel(): BaseChatModel | null {
    return this.model;
  }
  protected resolveModelName(options?: LLMOptions): string {
    return options?.model ?? this.defaultModel;
  }
}

function fakeModel(overrides: Partial<BaseChatModel>): BaseChatModel {
  return {
    invoke: jest.fn(),
    stream: jest.fn(),
    withStructuredOutput: jest.fn(),
    ...overrides,
  } as unknown as BaseChatModel;
}

describe('messageContentToString', () => {
  it('nối các phần content dạng mảng', () => {
    expect(
      messageContentToString([{ type: 'text', text: 'a' }, ' ', { text: 'b' }]),
    ).toBe('a b');
  });
});

describe('BaseLangChainLlmProvider.chat', () => {
  it('ánh xạ usage_metadata của LangChain sang TokenUsage + chi phí', async () => {
    const response = new AIMessage({
      content: 'pong',
      response_metadata: { finish_reason: 'stop' },
      usage_metadata: {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
      },
    });
    const provider = new FakeProvider(
      fakeModel({ invoke: jest.fn().mockResolvedValue(response) }),
    );

    const res = await provider.chat([{ role: 'user', content: 'ping' }], {
      model: 'gpt-4o',
    });

    expect(res.content).toBe('pong');
    expect(res.usage.inputTokens).toBe(10);
    expect(res.usage.outputTokens).toBe(4);
    expect(res.usage.totalTokens).toBe(14);
    expect(res.usage.estimatedCost).toBeGreaterThan(0);
    expect(res.finishReason).toBe('stop');
    expect(res.provider).toBe(LlmProvider.OPENAI);
  });

  it('ném LlmError AUTH khi provider chưa cấu hình', async () => {
    const provider = new FakeProvider(null);
    await expect(
      provider.chat([{ role: 'user', content: 'x' }]),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('retry lỗi 503 rồi thành công, bọc lỗi cuối bằng LlmError', async () => {
    const invoke = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue(new AIMessage({ content: 'ok' }));
    const provider = new FakeProvider(fakeModel({ invoke }));
    const res = await provider.chat([{ role: 'user', content: 'x' }]);
    expect(res.content).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('bọc lỗi không retryable của provider thành LlmError', async () => {
    const provider = new FakeProvider(
      fakeModel({ invoke: jest.fn().mockRejectedValue({ status: 400 }) }),
    );
    await expect(
      provider.chat([{ role: 'user', content: 'x' }]),
    ).rejects.toBeInstanceOf(LlmError);
  });
});

describe('BaseLangChainLlmProvider.chatStructured', () => {
  it('validate lại output của provider bằng Zod', async () => {
    const schema = z.object({ answer: z.string(), score: z.number() });
    const withStructuredOutput = jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        raw: new AIMessage({
          content: '',
          usage_metadata: {
            input_tokens: 3,
            output_tokens: 2,
            total_tokens: 5,
          },
        }),
        parsed: { answer: 'yes', score: 0.9 },
      }),
    });
    const provider = new FakeProvider(fakeModel({ withStructuredOutput }));

    const res = await provider.chatStructured(
      [{ role: 'user', content: 'q' }],
      schema,
    );
    expect(res.data).toEqual({ answer: 'yes', score: 0.9 });
    expect(res.usage.totalTokens).toBe(5);
  });
});
