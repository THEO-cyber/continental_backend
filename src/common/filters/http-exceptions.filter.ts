import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Keeps the v1 API error contract the three frontends rely on:
 *   API routes    -> { "error": "<human readable message>" }
 *   Other routes  -> 404s redirect to the home page, 500s render plain text.
 */
@Catch()
export class HttpExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const m = (body as { message?: string | string[] }).message;
        message = Array.isArray(m) ? m.join('; ') : m || exception.message;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) {
      res.status(status).json({ error: message });
      return;
    }
    if (status === HttpStatus.NOT_FOUND) {
      res.redirect(302, '/');
      return;
    }
    res.status(status).type('text/plain').send(message);
  }
}
