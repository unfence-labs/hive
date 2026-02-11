export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = "bad_request") {
    super(message, 400, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, code = "unauthorized") {
    super(message, 401, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = "not_found") {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(message, 409, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string, code = "too_many_requests") {
    super(message, 429, code);
  }
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function errorStatus(err: unknown, fallback = 500): number {
  if (err instanceof AppError) return err.statusCode;
  return fallback;
}
