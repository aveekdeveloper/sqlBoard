import type { ApiErrorCode } from '@sqlboard/shared';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode | string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFound(message: string): ApiError {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', message, details);
}

export function connectionFailed(message: string): ApiError {
  return new ApiError(502, 'CONNECTION_FAILED', message);
}

export function queryFailed(message: string): ApiError {
  return new ApiError(500, 'QUERY_FAILED', message);
}
