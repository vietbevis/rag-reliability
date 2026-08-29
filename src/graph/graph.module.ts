import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { Neo4jHealthIndicator } from './neo4j.health';
import { Neo4jSchemaService } from './neo4j-schema.service';
import { Neo4jService } from './neo4j.service';

/**
 * Hạ tầng Neo4j cho Graph RAG (PHASE 5). `@Global` để `rag/graph` và health
 * dùng `Neo4jService` mà không phải import lại. Khi `GRAPH_RAG_ENABLED=false`
 * mọi thứ vẫn wire được nhưng `Neo4jService` không mở kết nối.
 */
@Global()
@Module({
  imports: [TerminusModule],
  providers: [Neo4jService, Neo4jSchemaService, Neo4jHealthIndicator],
  exports: [Neo4jService, Neo4jHealthIndicator],
})
export class GraphModule {}
