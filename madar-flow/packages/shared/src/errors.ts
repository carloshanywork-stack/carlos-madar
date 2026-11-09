export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'token_reuse_detected'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'email_taken'
  | 'rate_limited'
  | 'internal_error'
  | 'not_ready'
  | 'unsupported_media_type';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly title: string;

  constructor(status: number, code: ErrorCode, title: string, message?: string) {
    super(message ?? title);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.title = title;
  }

  static badRequest(code: ErrorCode, title: string, message?: string): AppError {
    return new AppError(400, code, title, message);
  }

  static unauthorized(
    code: ErrorCode = 'unauthorized',
    title = 'Unauthorized',
    message?: string,
  ): AppError {
    return new AppError(401, code, title, message);
  }

  static forbidden(code: ErrorCode = 'forbidden', title = 'Forbidden', message?: string): AppError {
    return new AppError(403, code, title, message);
  }

  static notFound(code: ErrorCode = 'not_found', title = 'Not found', message?: string): AppError {
    return new AppError(404, code, title, message);
  }

  static conflict(code: ErrorCode = 'conflict', title = 'Conflict', message?: string): AppError {
    return new AppError(409, code, title, message);
  }

  static internal(
    code: ErrorCode = 'internal_error',
    title = 'Internal error',
    message?: string,
  ): AppError {
    return new AppError(500, code, title, message);
  }
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  traceId?: string;
}

export function toProblemDetails(
  error: AppError,
  options: { instance?: string; traceId?: string; detail?: string } = {},
): ProblemDetails {
  return {
    type: `https://errors.madar-flow.local/${error.code}`,
    title: error.title,
    status: error.status,
    detail: options.detail ?? error.message,
    instance: options.instance,
    code: error.code,
    traceId: options.traceId,
  };
}
