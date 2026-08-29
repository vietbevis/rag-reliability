import { mockConfigService } from '../config/config.mock';
import { GraphError } from '../common/errors';
import { Neo4jService } from './neo4j.service';

describe('Neo4jService (GRAPH_RAG_ENABLED=false)', () => {
  const svc = new Neo4jService(
    mockConfigService({ graph: { enabled: false } }),
  );

  it('enabled=false, chưa kết nối', () => {
    expect(svc.enabled).toBe(false);
    expect(svc.isConnected).toBe(false);
  });

  it('onModuleInit không mở driver, không ném', async () => {
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('read/write/writeTx đều ném GRAPH_DISABLED', async () => {
    await expect(svc.read('RETURN 1')).rejects.toMatchObject({
      code: 'GRAPH_DISABLED',
    });
    await expect(svc.write('RETURN 1')).rejects.toBeInstanceOf(GraphError);
    await expect(svc.writeTx(() => Promise.resolve(1))).rejects.toMatchObject({
      code: 'GRAPH_DISABLED',
    });
  });

  it('onModuleDestroy an toàn khi chưa có driver', async () => {
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
  });
});
