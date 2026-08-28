import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';

const DISTANCE_OPS: Record<string, string> = {
  cosine: 'vector_cosine_ops',
  l2: 'vector_l2_ops',
  ip: 'vector_ip_ops',
};

/**
 * Kiểm tra (CHỈ kiểm tra, không tự sửa) schema vector lúc khởi động (PROMPT §15,
 * §51). Cột `Embedding.embedding` và ANN index do SQL migration quản lý; nếu
 * `EMBEDDING_DIMENSION` / `EMBEDDING_DISTANCE` không khớp với schema thực tế,
 * log CẢNH BÁO rõ ràng để người vận hành chạy migration phù hợp.
 */
@Injectable()
export class VectorSchemaService implements OnModuleInit {
  private readonly logger = new Logger(VectorSchemaService.name);
  private readonly cfgDimension: number;
  private readonly cfgDistance: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {
    const emb = config.get('embedding', { infer: true });
    this.cfgDimension = emb.dimension;
    this.cfgDistance = emb.distance;
  }

  async onModuleInit(): Promise<void> {
    try {
      const columnDim = await this.getColumnDimension();
      const indexOps = await this.getIndexOps();

      if (columnDim !== null && columnDim !== this.cfgDimension) {
        this.logger.warn(
          `EMBEDDING_DIMENSION=${this.cfgDimension} KHÔNG khớp cột "Embedding".embedding (vector(${columnDim})). ` +
            `Cần một migration mới đổi cột về vector(${this.cfgDimension}); nếu không, việc ghi embedding sẽ lỗi.`,
        );
      }
      const wantOps = DISTANCE_OPS[this.cfgDistance];
      if (indexOps.length > 0 && wantOps && !indexOps.includes(wantOps)) {
        this.logger.warn(
          `EMBEDDING_DISTANCE=${this.cfgDistance} (${wantOps}) nhưng ANN index hiện là [${indexOps.join(', ')}]. ` +
            `Truy vấn vector nên dùng metric khớp index để tận dụng được index.`,
        );
      }
      if (indexOps.length === 0) {
        this.logger.warn(
          'Chưa có ANN index (hnsw/ivfflat) trên "Embedding".embedding — vector search sẽ quét tuần tự.',
        );
      }
    } catch (err) {
      this.logger.warn(
        `Không kiểm tra được schema vector: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Số chiều khai báo của cột `embedding`, hoặc null nếu không xác định. */
  async getColumnDimension(): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<Array<{ dim: number }>>`
      SELECT atttypmod AS dim
      FROM pg_attribute
      WHERE attrelid = '"Embedding"'::regclass AND attname = 'embedding'
    `;
    const dim = rows[0]?.dim;
    return dim === undefined || dim < 0 ? null : dim;
  }

  /** Các opclass của ANN index trên cột `embedding` (rỗng nếu chưa có). */
  async getIndexOps(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ opcname: string }>>`
      SELECT op.opcname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_opclass op ON op.oid = ANY (i.indclass)
      WHERE t.relname = 'Embedding'
        AND op.opcname LIKE 'vector_%'
    `;
    return rows.map((r) => r.opcname);
  }

  /** Toán tử khoảng cách pgvector cho metric đang cấu hình. */
  get distanceOperator(): '<=>' | '<->' | '<#>' {
    return this.cfgDistance === 'l2'
      ? '<->'
      : this.cfgDistance === 'ip'
        ? '<#>'
        : '<=>';
  }
}
