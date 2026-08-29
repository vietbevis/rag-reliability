import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';
import { GraphError } from '../../common/errors';
import { Neo4jService } from '../../graph/neo4j.service';
import { GraphCleanupService } from './graph-cleanup.service';

@ApiTags('graph')
@Controller('graph')
export class GraphController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
    private readonly cleanup: GraphCleanupService,
  ) {}

  @Post('reconcile')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Đối soát graph Neo4j với documentId hợp lệ trong Postgres, xoá phần mồ côi (graph-rag.md §0)',
  })
  async reconcile() {
    if (!this.neo4j.enabled) {
      throw new GraphError('GRAPH_DISABLED', 'GRAPH_RAG_ENABLED=false');
    }
    const docs = await this.prisma.document.findMany({ select: { id: true } });
    const result = await this.cleanup.reconcile(docs.map((d) => d.id));
    return { validDocuments: docs.length, ...result };
  }
}
