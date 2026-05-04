import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, ErrorCode } from "../lib/errors.js";

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // Log the error using pino-http's logger if available, otherwise console
  const logger = (req as any).log || console;
  
  let statusCode = 500;
  let errorCode = ErrorCode.INTERNAL_ERROR;
  let message = "An unexpected error occurred";
  let details: any = undefined;

  // Handle Custom App Errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.code as ErrorCode;
    message = err.message;
    details = err.details;
  } 
  // Handle Zod Validation Errors
  else if (err instanceof ZodError) {
    statusCode = 400;
    errorCode = ErrorCode.VALIDATION_ERROR;
    message = "Validation failed";
    details = err.errors.map(e => ({
      path: e.path.join('.'),
      message: e.message
    }));
  }
  // Handle Prisma Database Errors
  else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    statusCode = 400;
    errorCode = ErrorCode.PRISMA_ERROR;
    message = "Database operation failed";
    
    // P2002: Unique constraint failed
    if (err.code === 'P2002') {
      statusCode = 409;
      message = `A record with this ${err.meta?.target || 'value'} already exists.`;
    }
    // P2025: Record to update/delete not found
    else if (err.code === 'P2025') {
      statusCode = 404;
      message = "Record not found.";
    }
    details = { prismaCode: err.code, meta: err.meta };
  }
  // Handle generic Errors
  else if (err instanceof Error) {
    message = err.message;
    // Keep 500 status code for generic errors
  }

  // Log non-4xx errors as errors, 4xx as warnings
  if (statusCode >= 500) {
    logger.error({ err, path: req.path }, "Internal Server Error");
  } else {
    logger.warn({ err: { message: err.message, code: err.code }, path: req.path }, "Request Error");
  }

  res.status(statusCode).json({
    success: false,
    error: errorCode,
    message,
    ...(details && { details }),
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
}
