import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';

/**
 * Catch-all HTTP exception filter.
 *
 * Deliberate `@Catch()` with no argument, so *every* throw reaching the request
 * boundary is turned into a well-formed JSON error — including the ones that are
 * not `HttpException`s. Without this, a Mongoose `CastError` or a duplicate-key
 * write conflict surfaced as a bare 500 carrying driver internals, which the
 * client then rendered as an opaque failure.
 *
 * The response shape matches what Nest's own exceptions produce
 * (`{ statusCode, message, error }`), because the client's `errorMessage()`
 * helper already reads that shape.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, error } = this.describe(exception);

    // 5xx is a defect worth a stack trace; 4xx is normal client behaviour.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      path: request.url,
    });
  }

  private describe(exception: unknown): { status: number; message: string; error: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // Nest puts validation-pipe details in `message`, which may be an array.
      const message =
        typeof body === 'string'
          ? body
          : ((body as any)?.message ?? exception.message);
      return {
        status,
        message: Array.isArray(message) ? message.join('; ') : String(message),
        error: (typeof body === 'object' && (body as any)?.error) || exception.name,
      };
    }

    // A malformed ObjectId in a route param — a client mistake, not a defect.
    if (exception instanceof MongooseError.CastError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: `Invalid value for '${exception.path}'`,
        error: 'Bad Request',
      };
    }

    if (exception instanceof MongooseError.ValidationError) {
      const details = Object.values(exception.errors ?? {})
        .map(e => e.message)
        .join('; ');
      return {
        status: HttpStatus.BAD_REQUEST,
        message: details || 'Validation failed',
        error: 'Bad Request',
      };
    }

    // Duplicate key — a unique index rejected the write (e.g. re-registering an
    // email, or the like index catching a concurrent double-tap).
    if (typeof exception === 'object' && exception !== null && (exception as any).code === 11000) {
      return {
        status: HttpStatus.CONFLICT,
        message: 'That record already exists',
        error: 'Conflict',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      // Never surface a raw driver/stack message to the client.
      message: 'Something went wrong. Please try again.',
      error: 'Internal Server Error',
    };
  }
}
