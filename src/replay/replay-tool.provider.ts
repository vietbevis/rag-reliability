import { Logger } from '@nestjs/common';
import type {
  AgentTool,
  ToolDefinition,
  ToolId,
  ToolResult,
} from '../tools/core/tool.types';
import { toolCallKey } from '../agent/graph/guards/loop-detector';
import type {
  ProviderHealth,
  ToolProvider,
} from '../tools/providers/tool-provider.interface';
import type { ToolRegistryService } from '../tools/registry/tool-registry.service';

export type ReplayMode = 'dry-run' | 'recorded' | 'live-read';

export interface RecordedStep {
  toolName: string | null;
  toolInput: unknown;
  toolOutput: unknown;
  evidence: unknown;
  error: string | null;
}

/**
 * Provider replay (target-state.md §11). Định nghĩa tool lấy từ registry THẬT
 * (đảm bảo schema khớp); phần `execute` tuỳ mode:
 * - `dry-run`   : không execute gì — trả kết quả đã ghi (hoặc rỗng).
 * - `recorded`  : trả kết quả đã ghi cho (toolName + args) khớp.
 * - `live-read` : execute THẬT nếu tool `sideEffect === 'read-only'`; còn lại
 *                 dùng kết quả đã ghi. **Không bao giờ blind replay
 *                 side-effecting** (PROMPT §36).
 */
export class ReplayToolProvider implements ToolProvider {
  readonly id = 'replay';
  readonly name = 'Replay';
  readonly type = 'local' as const;
  private readonly logger = new Logger(ReplayToolProvider.name);
  private readonly recorded = new Map<string, RecordedStep>();

  constructor(
    private readonly live: ToolRegistryService,
    steps: RecordedStep[],
    private readonly mode: ReplayMode,
  ) {
    for (const s of steps) {
      if (!s.toolName) continue;
      this.recorded.set(
        toolCallKey(s.toolName.replace(/__/g, '.'), s.toolInput),
        s,
      );
    }
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  listTools(): Promise<ToolDefinition[]> {
    return Promise.resolve(this.live.list());
  }

  getTool(id: ToolId): Promise<AgentTool | undefined> {
    const liveTool = this.live.get(id);
    if (!liveTool) return Promise.resolve(undefined);
    return Promise.resolve({
      definition: liveTool.definition,
      execute: async (input, ctx): Promise<ToolResult> => {
        const key = toolCallKey(id, input);
        const rec = this.recorded.get(key);
        const readOnly =
          liveTool.definition.metadata.sideEffect === 'read-only';

        if (this.mode === 'live-read' && readOnly) {
          return liveTool.execute(input, ctx);
        }
        if (rec) {
          return recordedToResult(rec);
        }
        this.logger.warn(
          `replay: không có kết quả đã ghi cho ${id} — trả rỗng (mode ${this.mode})`,
        );
        return {
          success: false,
          error: {
            code: 'TOOL_EXECUTION_ERROR',
            message: `replay: không có bản ghi cho ${id}`,
            retryable: false,
          },
          evidence: [],
        };
      },
    });
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.id,
      status: 'healthy',
      toolCount: this.recorded.size,
      checkedAt: new Date().toISOString(),
    });
  }
}

function recordedToResult(rec: RecordedStep): ToolResult {
  const evidence = Array.isArray(rec.evidence)
    ? (rec.evidence as ToolResult['evidence'])
    : [];
  if (rec.error) {
    return {
      success: false,
      error: {
        code: 'TOOL_EXECUTION_ERROR',
        message: rec.error,
        retryable: false,
      },
      evidence: [],
    };
  }
  return { success: true, data: rec.toolOutput, evidence };
}
