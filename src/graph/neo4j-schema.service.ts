import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Neo4jService } from './neo4j.service';

/**
 * Tạo constraint + index cho graph lúc khởi động (graph-rag.md §2), idempotent
 * (`IF NOT EXISTS`). Tương tự `VectorSchemaService` cho pgvector nhưng graph
 * schema do ứng dụng sở hữu hoàn toàn nên ở đây TẠO chứ không chỉ cảnh báo.
 * Neo4j lỗi lúc boot → chỉ log, không chặn app (retriever/ingestion tự xử lý).
 */
@Injectable()
export class Neo4jSchemaService implements OnModuleInit {
  private readonly logger = new Logger(Neo4jSchemaService.name);

  private static readonly STATEMENTS = [
    'CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE',
    'CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE',
    'CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)',
    'CREATE INDEX entity_docids IF NOT EXISTS FOR (e:Entity) ON (e.documentIds)',
    'CREATE INDEX rel_docids IF NOT EXISTS FOR ()-[r:RELATED]-() ON (r.documentIds)',
    'CREATE INDEX chunk_docid IF NOT EXISTS FOR (c:Chunk) ON (c.documentId)',
  ];

  constructor(private readonly neo4j: Neo4jService) {}

  async onModuleInit(): Promise<void> {
    if (!this.neo4j.enabled) return;
    try {
      for (const stmt of Neo4jSchemaService.STATEMENTS) {
        await this.neo4j.write(stmt);
      }
      this.logger.log(
        `Đã đảm bảo ${Neo4jSchemaService.STATEMENTS.length} constraint/index của graph`,
      );
    } catch (err) {
      this.logger.error(
        `Không tạo được schema Neo4j (sẽ thử lại khi có thao tác graph): ${(err as Error).message}`,
      );
    }
  }
}
