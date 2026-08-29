import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Neo4jService } from './neo4j.service';

/**
 * Kiểm tra sống của Neo4j — CHỈ khi `GRAPH_RAG_ENABLED=true`. Khi tắt, trả `up`
 * kèm `{ enabled: false }` để `/health` không đỏ vì một tính năng không dùng.
 */
@Injectable()
export class Neo4jHealthIndicator {
  constructor(
    private readonly health: HealthIndicatorService,
    private readonly neo4j: Neo4jService,
  ) {}

  async check(key = 'neo4j'): Promise<HealthIndicatorResult> {
    const indicator = this.health.check(key);
    if (!this.neo4j.enabled) return indicator.up({ enabled: false });
    try {
      await this.neo4j.verify();
      return indicator.up({ enabled: true });
    } catch (err) {
      return indicator.down({
        enabled: true,
        message: err instanceof Error ? err.message : 'unreachable',
      });
    }
  }
}
