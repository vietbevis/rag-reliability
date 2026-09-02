import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigError } from '../../common/errors';
import type { ToolSpec } from '../../ai/llm/llm.interface';
import { AGENT_TOOLS, type AgentTool } from './tool.interface';

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

/**
 * Sổ đăng ký tool của agent (PHASE 17 §5). Kiểm tra bất biến lúc khởi động
 * (tên snake_case, không trùng, v1 chỉ `read`) và phân giải danh sách tool cho
 * một request theo `toolAllowlist`.
 */
@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly byName = new Map<string, AgentTool>();

  constructor(@Inject(AGENT_TOOLS) tools: AgentTool[]) {
    for (const tool of tools) {
      if (!SNAKE_CASE.test(tool.name)) {
        throw new ConfigError(
          `Tên tool không hợp lệ (phải snake_case): "${tool.name}"`,
        );
      }
      if (this.byName.has(tool.name)) {
        throw new ConfigError(`Tool trùng tên: "${tool.name}"`);
      }
      if (tool.access !== 'read') {
        throw new ConfigError(
          `Tool "${tool.name}" có access="${tool.access}" — v1 chỉ chấp nhận read (§3.1)`,
        );
      }
      this.byName.set(tool.name, tool);
    }
    this.logger.log(
      `Đã đăng ký ${this.byName.size} tool: ${[...this.byName.keys()].join(', ') || '(rỗng)'}`,
    );
  }

  /** Mọi tool đã đăng ký. */
  all(): AgentTool[] {
    return [...this.byName.values()];
  }

  get(name: string): AgentTool | undefined {
    return this.byName.get(name);
  }

  /**
   * Phân giải danh sách tool cho một request. `allowlist` rỗng/không truyền →
   * tất cả tool. Tên không tồn tại → `ConfigError` (lỗi cấu hình phía client,
   * không im lặng bỏ qua).
   */
  resolve(allowlist?: readonly string[]): AgentTool[] {
    if (!allowlist || allowlist.length === 0) return this.all();
    const unknown = allowlist.filter((n) => !this.byName.has(n));
    if (unknown.length > 0) {
      throw new ConfigError(
        `toolAllowlist chứa tool không tồn tại: ${unknown.join(', ')}`,
      );
    }
    return allowlist.map((n) => this.byName.get(n)!);
  }

  /** Chuyển sang `ToolSpec[]` để feed vào `LlmService.chatWithTools`. */
  toSpecs(tools: readonly AgentTool[]): ToolSpec[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }
}
