import { Injectable } from '@nestjs/common';
import {
  all,
  create,
  type FactoryFunctionMap,
  type MathJsInstance,
} from 'mathjs';
import { z } from 'zod';
import type {
  AgentTool,
  ToolExecutionContext,
  ToolResult,
} from '../core/tool.types';
import { localToolDefinition } from './local-tool.helpers';

const MAX_EXPRESSION_LENGTH = 500;

const inputSchema = z.object({
  expression: z
    .string()
    .trim()
    .min(1)
    .max(MAX_EXPRESSION_LENGTH)
    .describe(
      'Biểu thức số học/toán học, cú pháp mathjs. Ví dụ: "1234 * 0.15", ' +
        '"sqrt(2)", "(3 + 4) / 7 * 100".',
    ),
});

const outputSchema = z.object({
  expression: z.string(),
  result: z.string().describe('Kết quả đã format (chuỗi để an toàn mọi kiểu).'),
});

type CalculatorInput = z.infer<typeof inputSchema>;
type CalculatorOutput = z.infer<typeof outputSchema>;

/**
 * Máy tính tất định (PROMPT §9). Sửa điểm yếu số học của LLM. KHÔNG gọi LLM.
 * `mathjs` hardened: vô hiệu hoá `import`/`createUnit`/`evaluate`/`parse`/
 * `simplify`/`derivative` theo mathjs security playbook.
 */
@Injectable()
export class CalculatorTool implements AgentTool<
  CalculatorInput,
  CalculatorOutput
> {
  readonly definition = localToolDefinition({
    id: 'calculator.calculate',
    displayName: 'Calculator',
    description:
      'Tính một biểu thức số học/toán học một cách chính xác, tất định. Dùng ' +
      'cho MỌI phép tính (cộng trừ nhân chia, phần trăm, luỹ thừa, căn…) thay ' +
      'vì tự nhẩm.',
    inputSchema,
    outputSchema,
    timeoutMs: 2000,
    tags: ['math', 'deterministic'],
  });

  private readonly math: MathJsInstance;
  private readonly evaluate: MathJsInstance['evaluate'];

  constructor() {
    this.math = create(all as FactoryFunctionMap, {});
    this.evaluate = this.math.evaluate.bind(this.math);
    const blocked = (): never => {
      throw new Error('function is disabled for security reasons');
    };
    this.math.import(
      {
        import: blocked,
        createUnit: blocked,
        evaluate: blocked,
        parse: blocked,
        simplify: blocked,
        derivative: blocked,
      },
      { override: true },
    );
  }

  execute(
    input: CalculatorInput,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult<CalculatorOutput>> {
    const { expression } = input;
    try {
      const value: unknown = this.evaluate(expression, {});
      if (typeof value === 'function') {
        throw new Error('biểu thức trả về một hàm, không phải giá trị');
      }
      const result = this.math.format(value, { precision: 14 });
      return Promise.resolve({
        success: true,
        data: outputSchema.parse({ expression, result }),
        evidence: [
          {
            kind: 'computation',
            ref: expression,
            text: `${expression} = ${result}`,
          },
        ],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'lỗi không xác định';
      ctx.logger.debug(`calculator: "${expression}" lỗi — ${message}`);
      return Promise.resolve({
        success: false,
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: `Không tính được "${expression}": ${message}`,
          retryable: false,
        },
        evidence: [],
      });
    }
  }
}
