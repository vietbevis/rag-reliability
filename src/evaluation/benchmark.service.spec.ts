import { PrismaService } from '../database/prisma.service';
import { BenchmarkService } from './benchmark.service';

interface FakeRun {
  id: string;
  datasetId: string;
  isBaseline: boolean;
  status: string;
  metrics: Record<string, number>;
  createdAt: Date;
}

function makePrisma(runs: FakeRun[]): PrismaService {
  return {
    evaluationRun: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(runs.find((r) => r.id === where.id) ?? null),
      ),
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: {
            datasetId: string;
            isBaseline: boolean;
            id: { not: string };
          };
        }) =>
          Promise.resolve(
            runs
              .filter(
                (r) =>
                  r.datasetId === where.datasetId &&
                  r.isBaseline &&
                  r.status === 'COMPLETED' &&
                  r.id !== where.id.not,
              )
              .sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null,
          ),
      ),
    },
  } as unknown as PrismaService;
}

const baseRun: FakeRun = {
  id: 'base',
  datasetId: 'd1',
  isBaseline: true,
  status: 'COMPLETED',
  metrics: { recallAt5: 0.8, hallucinationRateProxy: 0.05, mrr: 0.6 },
  createdAt: new Date('2026-01-01'),
};

describe('BenchmarkService', () => {
  it('không có baseline -> regressed=false, baselineRunId=null', async () => {
    const cur: FakeRun = { ...baseRun, id: 'cur', isBaseline: false };
    const svc = new BenchmarkService(makePrisma([cur]));
    const cmp = await svc.compareToBaseline('cur');
    expect(cmp.baselineRunId).toBeNull();
    expect(cmp.regressed).toBe(false);
  });

  it('recall tụt quá ngưỡng -> regressed', async () => {
    const cur: FakeRun = {
      ...baseRun,
      id: 'cur',
      isBaseline: false,
      metrics: { recallAt5: 0.7, hallucinationRateProxy: 0.05, mrr: 0.6 },
      createdAt: new Date('2026-02-01'),
    };
    const svc = new BenchmarkService(makePrisma([baseRun, cur]));
    const cmp = await svc.compareToBaseline('cur');
    expect(cmp.baselineRunId).toBe('base');
    expect(cmp.regressed).toBe(true);
    expect(cmp.reasons.join(' ')).toMatch(/recallAt5/);
    const d = cmp.deltas.find((x) => x.metric === 'recallAt5');
    expect(d?.delta).toBeCloseTo(-0.1, 4);
  });

  it('hallucination tăng quá ngưỡng -> regressed', async () => {
    const cur: FakeRun = {
      ...baseRun,
      id: 'cur',
      isBaseline: false,
      metrics: { recallAt5: 0.82, hallucinationRateProxy: 0.12, mrr: 0.6 },
      createdAt: new Date('2026-02-01'),
    };
    const svc = new BenchmarkService(makePrisma([baseRun, cur]));
    const cmp = await svc.compareToBaseline('cur');
    expect(cmp.regressed).toBe(true);
    expect(cmp.reasons.join(' ')).toMatch(/hallucination/i);
  });

  it('cải thiện đều -> không regressed', async () => {
    const cur: FakeRun = {
      ...baseRun,
      id: 'cur',
      isBaseline: false,
      metrics: { recallAt5: 0.85, hallucinationRateProxy: 0.03, mrr: 0.65 },
      createdAt: new Date('2026-02-01'),
    };
    const svc = new BenchmarkService(makePrisma([baseRun, cur]));
    const cmp = await svc.compareToBaseline('cur');
    expect(cmp.regressed).toBe(false);
    expect(cmp.reasons).toEqual([]);
  });

  it('faithfulness giảm quá 5% -> regressed', async () => {
    const base: FakeRun = {
      ...baseRun,
      metrics: { recallAt5: 0.8, faithfulness: 0.95 },
    };
    const cur: FakeRun = {
      ...baseRun,
      id: 'cur',
      isBaseline: false,
      metrics: { recallAt5: 0.8, faithfulness: 0.85 },
      createdAt: new Date('2026-02-01'),
    };
    const svc = new BenchmarkService(makePrisma([base, cur]));
    const cmp = await svc.compareToBaseline('cur');
    expect(cmp.regressed).toBe(true);
    expect(cmp.reasons.join(' ')).toMatch(/faithfulness/);
  });

  it('setBaseline: cập nhật isBaseline=true cho run mục tiêu và gỡ baseline cũ', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const updateMock = jest.fn().mockResolvedValue({ id: 'r2', isBaseline: true });
    const findUniqueMock = jest.fn().mockResolvedValue({ id: 'r2', datasetId: 'd1' });

    const prisma = {
      evaluationRun: {
        findUnique: findUniqueMock,
        updateMany: updateManyMock,
        update: updateMock,
      },
    } as unknown as PrismaService;

    const svc = new BenchmarkService(prisma);
    const res = await svc.setBaseline('r2');

    expect(res.isBaseline).toBe(true);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { datasetId: 'd1', isBaseline: true },
      data: { isBaseline: false },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: { isBaseline: true },
    });
  });
});
