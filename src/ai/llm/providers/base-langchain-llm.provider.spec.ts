import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { LlmError } from '../../../common/errors';
import { LlmProvider } from '../llm-provider.enum';
import type { LLMOptions, ToolSpec } from '../llm.interface';
import {
  BaseLangChainLlmProvider,
  messageContentToString,
  toLangChainMessages,
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

/** Model giả có `bindTools` trả về một Runnable với `invoke` cho trước. */
function toolModel(
  invoke: jest.Mock,
  bindTools = jest.fn().mockReturnValue({ invoke }),
): BaseChatModel {
  return {
    invoke: jest.fn(),
    stream: jest.fn(),
    withStructuredOutput: jest.fn(),
    bindTools,
  } as unknown as BaseChatModel;
}

const weatherTool: ToolSpec = {
  name: 'get_weather',
  description: 'Thời tiết hiện tại của một thành phố',
  parameters: z.object({ city: z.string() }),
};

describe('messageContentToString', () => {
  it('nối các phần content dạng mảng', () => {
    expect(
      messageContentToString([{ type: 'text', text: 'a' }, ' ', { text: 'b' }]),
    ).toBe('a b');
  });
});

describe('toLangChainMessages', () => {
  it('map role "tool" → ToolMessage kèm tool_call_id', () => {
    const [msg] = toLangChainMessages([
      {
        role: 'tool',
        content: 'kết quả',
        toolCallId: 'c1',
        name: 'get_weather',
      },
    ]);
    expect(msg).toBeInstanceOf(ToolMessage);
    expect((msg as ToolMessage).tool_call_id).toBe('c1');
  });

  it('map assistant có toolCalls → AIMessage.tool_calls', () => {
    const [msg] = toLangChainMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'get_weather',
            args: { city: 'HN' },
            argsValid: true,
          },
        ],
      },
    ]);
    expect((msg as AIMessage).tool_calls?.[0]).toMatchObject({
      id: 'c1',
      name: 'get_weather',
      args: { city: 'HN' },
    });
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

describe('BaseLangChainLlmProvider.supportsNativeToolCalling', () => {
  it('true khi model có bindTools', () => {
    const provider = new FakeProvider(toolModel(jest.fn()));
    expect(provider.supportsNativeToolCalling()).toBe(true);
  });

  it('false khi model null hoặc thiếu bindTools', () => {
    expect(new FakeProvider(null).supportsNativeToolCalling()).toBe(false);
    expect(new FakeProvider(fakeModel({})).supportsNativeToolCalling()).toBe(
      false,
    );
  });
});

describe('BaseLangChainLlmProvider.chatWithTools', () => {
  it('parse tool_calls và validate args theo schema', async () => {
    const invoke = jest.fn().mockResolvedValue(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'c1',
            name: 'get_weather',
            args: { city: 'Hanoi' },
            type: 'tool_call',
          },
        ],
        usage_metadata: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
      }),
    );
    const provider = new FakeProvider(toolModel(invoke));

    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'thời tiết Hà Nội?' }],
      [weatherTool],
    );

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({
      id: 'c1',
      name: 'get_weather',
      args: { city: 'Hanoi' },
      argsValid: true,
    });
    expect(res.finishReason).toBe('tool_calls');
    expect(res.usage.totalTokens).toBe(8);
  });

  it('argsValid=false + giữ giá trị thô khi args sai schema', async () => {
    const invoke = jest.fn().mockResolvedValue(
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'c1',
            name: 'get_weather',
            args: { city: 123 },
            type: 'tool_call',
          },
        ],
      }),
    );
    const provider = new FakeProvider(toolModel(invoke));

    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'x' }],
      [weatherTool],
    );

    expect(res.toolCalls[0]!.argsValid).toBe(false);
    expect(res.toolCalls[0]!.args).toEqual({ city: 123 });
  });

  it('argsValid=false khi model gọi tool không khai báo', async () => {
    const invoke = jest.fn().mockResolvedValue(
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'c1', name: 'unknown_tool', args: {}, type: 'tool_call' },
        ],
      }),
    );
    const provider = new FakeProvider(toolModel(invoke));

    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'x' }],
      [weatherTool],
    );

    expect(res.toolCalls[0]).toMatchObject({
      name: 'unknown_tool',
      argsValid: false,
    });
  });

  it('toolCalls rỗng + content khi model trả lời thẳng', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValue(new AIMessage({ content: 'trời nắng' }));
    const provider = new FakeProvider(toolModel(invoke));

    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'x' }],
      [weatherTool],
    );

    expect(res.toolCalls).toHaveLength(0);
    expect(res.content).toBe('trời nắng');
  });

  it('ném LlmError khi model không hỗ trợ bindTools', async () => {
    const provider = new FakeProvider(fakeModel({}));
    await expect(
      provider.chatWithTools([{ role: 'user', content: 'x' }], [weatherTool]),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('toolChoice="required" → truyền tool_choice vào bindTools', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValue(new AIMessage({ content: 'ok' }));
    const bindTools = jest.fn().mockReturnValue({ invoke });
    const provider = new FakeProvider(toolModel(invoke, bindTools));

    await provider.chatWithTools(
      [{ role: 'user', content: 'x' }],
      [weatherTool],
      {
        toolChoice: 'required',
      },
    );

    expect(bindTools).toHaveBeenCalledWith(expect.any(Array), {
      tool_choice: 'required',
    });
  });

  it('endpoint từ chối tool_choice → thử lại KHÔNG ép', async () => {
    const invoke = jest
      .fn()
      .mockRejectedValueOnce({ status: 400 })
      .mockResolvedValue(new AIMessage({ content: 'ok' }));
    const bindTools = jest.fn().mockReturnValue({ invoke });
    const provider = new FakeProvider(toolModel(invoke, bindTools));

    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'x' }],
      [weatherTool],
      { toolChoice: 'required' },
    );

    expect(res.content).toBe('ok');
    // lần 2 bind KHÔNG kèm tool_choice
    expect(bindTools).toHaveBeenLastCalledWith(expect.any(Array), undefined);
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
