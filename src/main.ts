// Nạp .env vào process.env TRƯỚC khi import AppModule — QueueModule.register()
// đọc QUEUE_ENABLED ngay lúc dựng cây module (sớm hơn ConfigModule).
import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';
import { SWAGGER_PATH } from './common/constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const appCfg = config.get('app', { infer: true });

  app.use(compression());
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (appCfg.swaggerEnabled) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('RAG Reliability Service')
        .setDescription('Production-grade, high-reliability RAG. PHASE 0.')
        .setVersion('0.1.0')
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, doc);
  }

  await app.listen(appCfg.port, appCfg.host);
  Logger.log(
    `RAG Reliability Service listening on http://${appCfg.host}:${appCfg.port} ` +
      `(${appCfg.nodeEnv}, LLM=${config.get('llm', { infer: true }).provider})`,
    'Bootstrap',
  );
}

void bootstrap();
