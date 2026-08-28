import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  path: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

/**
 * Một shape JSON duy nhất cho mọi lỗi rời khỏi API. Các lớp con của
 * {@link AppError} giữ nguyên `code` máy đọc được; lỗi không xác định được báo
 * là `INTERNAL_ERROR` mà không lộ stack trace ra client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toBody(exception, request.url);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode} ${body.code}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${body.statusCode} ${body.code}: ${body.message}`,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, path: string): ErrorBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof AppError) {
      return {
        statusCode: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        context: exception.context,
        path,
        timestamp,
      };
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ??
            exception.message);
      return {
        statusCode: exception.getStatus(),
        code: 'HTTP_EXCEPTION',
        message: Array.isArray(message) ? message.join('; ') : message,
        path,
        timestamp,
      };
    }

    return {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      path,
      timestamp,
    };
  }
}
