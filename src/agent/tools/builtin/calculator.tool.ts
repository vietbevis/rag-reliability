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
  AgentToolContext,
  AgentToolResult,
} from '../tool.interface';

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
 * Máy tính tất định (PHASE 17 §7). Sửa điểm yếu số học của LLM — mọi phép tính
 * trong câu trả lời nên đi qua đây. KHÔNG gọi LLM.
 *
 * `mathjs` được vô hiệu hoá các hàm có thể chạy code / định nghĩa lại môi
 * trường (`import`, `createUnit`, `evaluate`, `parse`, `simplify`,
 * `derivative`) theo khuyến cáo bảo mật của mathjs.
 */
@Injectable()
export class CalculatorTool implements AgentTool<
  CalculatorInput,
  CalculatorOutput
> {
  readonly name = 'calculator';
  readonly description =
    'Tính một biểu thức số học/toán học một cách chính xác, tất định. Dùng cho ' +
    'MỌI phép tính (cộng trừ nhân chia, phần trăm, luỹ thừa, căn…) thay vì tự nhẩm.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'read' as const;
  readonly timeoutMs = 2000;
  readonly maxRetries = 0;

  private readonly math: MathJsInstance;
  /** `evaluate` đã hardened — bắt tham chiếu TRƯỚC khi vô hiệu hoá public API. */
  private readonly evaluate: MathJsInstance['evaluate'];

  constructor() {
    this.math = create(all as FactoryFunctionMap, {});
    // Giữ tham chiếu để gọi từ JS; sau `import` bên dưới, `math.evaluate` công
    // khai sẽ ném — nên biểu thức chứa `evaluate("...")`/`import(...)` bị chặn,
    // còn ta vẫn tính được (mathjs security playbook).
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
    ctx: AgentToolContext,
  ): Promise<AgentToolResult<CalculatorOutput>> {
    const { expression } = input;
    try {
      const value: unknown = this.evaluate(expression, {});
      if (typeof value === 'function') {
        throw new Error('biểu thức trả về một hàm, không phải giá trị');
      }
      const result = this.math.format(value, { precision: 14 });
      const data: CalculatorOutput = { expression, result };
      return Promise.resolve({
        ok: true,
        data: outputSchema.parse(data),
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
        ok: false,
        data: { expression, result: '' },
        evidence: [],
        error: `Không tính được "${expression}": ${message}`,
      });
    }
  }
}
