export enum ErrorCode {
  BAD_REQUEST = "BAD_REQUEST",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  PRISMA_ERROR = "PRISMA_ERROR",
  WORKFLOW_ERROR = "WORKFLOW_ERROR",
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode | string,
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly details?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = "Bad Request", details?: any) {
    super(ErrorCode.BAD_REQUEST, message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(ErrorCode.UNAUTHORIZED, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(ErrorCode.FORBIDDEN, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource Not Found") {
    super(ErrorCode.NOT_FOUND, message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Conflict", details?: any) {
    super(ErrorCode.CONFLICT, message, 409, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Validation Failed", details?: any) {
    super(ErrorCode.VALIDATION_ERROR, message, 422, details);
  }
}
