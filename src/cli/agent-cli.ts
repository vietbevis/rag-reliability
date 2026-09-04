import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AgentService } from '../agent/agent.service';
import { ToolRegistryService } from '../tools/registry/tool-registry.service';
import { ReplayService } from '../replay/replay.service';
import type { ReplayMode } from '../replay/replay-tool.provider';

/**
 * CLI quản trị agent + tool (PROMPT §37-38).
 *
 *   npm run agent:cli -- run "<task>" [--tools a,b]
 *   npm run agent:cli -- tools list [--provider <id>]
 *   npm run agent:cli -- tools inspect <toolId>
 *   npm run agent:cli -- providers list
 *   npm run agent:cli -- providers health
 *   npm run agent:cli -- providers refresh <id>
 *   npm run agent:cli -- replay <agentRunId> [--mode dry-run|recorded|live-read]
 */
async function main(): Promise<void> {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  const logger = new Logger('agent-cli');
  const flag = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  process.env.AGENT_ENABLED = process.env.AGENT_ENABLED ?? 'true';
  process.env.QUEUE_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const registry = app.get(ToolRegistryService);

  try {
    switch (cmd) {
      case 'run': {
        if (!sub) throw new Error('cần task: agent:cli -- run "<task>"');
        const tools = flag('tools')
          ?.split(',')
          .map((s) => s.trim());
        const res = await app
          .get(AgentService)
          .run(sub, { toolAllowlist: tools });
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case 'tools': {
        if (sub === 'list') {
          const provider = flag('provider');
          const rows = registry
            .list()
            .filter((d) => !provider || d.metadata.providerId === provider)
            .map((d) => ({
              id: d.id,
              provider: d.metadata.providerId,
              source: d.metadata.source,
              risk: d.metadata.riskLevel,
              sideEffect: d.metadata.sideEffect,
            }));
          console.table(rows);
        } else if (sub === 'inspect') {
          const t = registry.get(rest[0] ?? '');
          if (!t) throw new Error(`không có tool "${rest[0]}"`);
          console.log(JSON.stringify(t.definition.metadata, null, 2));
          console.log('description:', t.definition.description);
        } else {
          throw new Error('tools list | tools inspect <id>');
        }
        break;
      }
      case 'providers': {
        if (sub === 'list' || sub === 'health') {
          const health = await registry.providersHealth();
          console.table(health);
          for (const c of registry.knownCollisions()) logger.warn(c);
        } else if (sub === 'refresh') {
          await registry.refreshProvider(rest[0] ?? '');
          logger.log(`refreshed ${rest[0]}`);
        } else {
          throw new Error(
            'providers list | providers health | providers refresh <id>',
          );
        }
        break;
      }
      case 'replay': {
        if (!sub) throw new Error('cần agentRunId');
        const mode = (flag('mode') ?? 'recorded') as ReplayMode;
        const diff = await app.get(ReplayService).replay(sub, mode);
        console.log(JSON.stringify(diff, null, 2));
        break;
      }
      default:
        console.log(
          'lệnh: run | tools list|inspect | providers list|health|refresh | replay',
        );
        process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
