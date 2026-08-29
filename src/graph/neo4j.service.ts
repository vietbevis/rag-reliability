import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, {
  type Driver,
  type ManagedTransaction,
  type RecordShape,
} from 'neo4j-driver';
import type { AppConfig } from '../config/configuration';
import { GraphError } from '../common/errors';

/**
 * Bọc `neo4j-driver` (PHASE 5, graph-rag.md §3). Một `Driver` (connection pool)
 * suốt vòng đời app.
 *
 * - `GRAPH_RAG_ENABLED=false` → KHÔNG khởi tạo driver; mọi truy vấn ném
 *   `GraphError('GRAPH_DISABLED')` (caller phải guard bằng `enabled`).
 * - Lỗi kết nối / timeout khi đang bật → `GraphError('GRAPH_UNAVAILABLE')`
 *   (hạ tầng — caller nuốt hoặc giữ trạng thái để chạy lại, PROMPT §54).
 * - Mọi Cypher tham số hoá 100% (không nối chuỗi) — caller chịu trách nhiệm.
 */
@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);
  private readonly cfg: AppConfig['graph'];
  private driver: Driver | null = null;
  /** True sau khi `verifyConnectivity` thành công ít nhất một lần. */
  private connected = false;

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('graph', { infer: true });
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.enabled) {
      this.logger.log('Graph RAG tắt (GRAPH_RAG_ENABLED=false) — bỏ qua Neo4j');
      return;
    }
    const { uri, user, password, maxPoolSize } = this.cfg.neo4j;
    if (!uri || !password) {
      // env.schema đã chặn trường hợp này; guard thêm cho chắc.
      throw new GraphError(
        'GRAPH_UNAVAILABLE',
        'GRAPH_RAG_ENABLED=true nhưng thiếu NEO4J_URI / NEO4J_PASSWORD',
      );
    }
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionPoolSize: maxPoolSize,
      connectionAcquisitionTimeout: this.cfg.neo4j.queryTimeoutMs,
      disableLosslessIntegers: true,
    });
    try {
      await this.driver.verifyConnectivity();
      this.connected = true;
      this.logger.log(`Đã kết nối Neo4j (${uri})`);
    } catch (err) {
      // Không chặn boot: retriever/ingestion sẽ xử lý theo §54. Log rõ ràng.
      this.logger.error(
        `Không kết nối được Neo4j (${uri}): ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
    this.connected = false;
  }

  private require(): Driver {
    if (!this.cfg.enabled || !this.driver) {
      throw new GraphError(
        'GRAPH_DISABLED',
        'Neo4jService được gọi khi Graph RAG đang tắt',
      );
    }
    return this.driver;
  }

  /** Kiểm tra kết nối theo yêu cầu (dùng bởi health indicator). */
  async verify(): Promise<void> {
    try {
      await this.require().verifyConnectivity();
      this.connected = true;
    } catch (err) {
      this.connected = false;
      throw new GraphError(
        'GRAPH_UNAVAILABLE',
        (err as Error).message,
        {},
        {
          cause: err,
        },
      );
    }
  }

  /** Đọc: trả về mảng bản ghi đã map sang object thuần. */
  async read<T extends RecordShape = RecordShape>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    return this.exec<T>(cypher, params, 'READ');
  }

  /** Ghi một câu Cypher đơn. Với batch/nhiều bước → dùng {@link writeTx}. */
  async write<T extends RecordShape = RecordShape>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    return this.exec<T>(cypher, params, 'WRITE');
  }

  /**
   * Giao dịch ghi có quản lý — driver TỰ retry lỗi transient/deadlock. Dùng cho
   * `UNWIND ... MERGE` theo lô và các thao tác nhiều bước (write graph, cleanup).
   */
  async writeTx<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.require().session({
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      return await session.executeWrite(work, {
        timeout: this.cfg.neo4j.queryTimeoutMs,
      });
    } catch (err) {
      throw this.wrap(err);
    } finally {
      await session.close();
    }
  }

  private async exec<T extends RecordShape>(
    cypher: string,
    params: Record<string, unknown>,
    mode: 'READ' | 'WRITE',
  ): Promise<T[]> {
    const session = this.require().session({
      defaultAccessMode:
        mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE,
    });
    try {
      const run = (tx: ManagedTransaction) => tx.run<T>(cypher, params);
      const res =
        mode === 'READ'
          ? await session.executeRead(run, {
              timeout: this.cfg.neo4j.queryTimeoutMs,
            })
          : await session.executeWrite(run, {
              timeout: this.cfg.neo4j.queryTimeoutMs,
            });
      return res.records.map((r) => r.toObject());
    } catch (err) {
      throw this.wrap(err);
    } finally {
      await session.close();
    }
  }

  private wrap(err: unknown): Error {
    if (err instanceof GraphError) return err;
    this.connected = false;
    return new GraphError(
      'GRAPH_UNAVAILABLE',
      `Neo4j lỗi: ${(err as Error).message}`,
      {},
      { cause: err },
    );
  }
}
