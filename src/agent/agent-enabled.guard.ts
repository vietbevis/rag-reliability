import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/**
 * Chặn mọi route `/agent/*` khi `AGENT_ENABLED=false` (PHASE 17 §2). `AgentService`
 * vẫn chạy được cho test/eval — chỉ tầng HTTP bị khoá.
 */
@Injectable()
export class AgentEnabledGuard implements CanActivate {
  private readonly enabled: boolean;

  constructor(config: ConfigService<AppConfig, true>) {
    this.enabled = config.get('agent', { infer: true }).enabled;
  }

  canActivate(): boolean {
    if (!this.enabled) {
      throw new ForbiddenException(
        'Tính năng agent đang tắt (AGENT_ENABLED=false).',
      );
    }
    return true;
  }
}
