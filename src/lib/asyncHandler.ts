import type { Request, Response, NextFunction } from "express";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

/**
 * Wraps an async function to catch any errors and pass them to the next middleware.
 * This eliminates the need for try-catch blocks in every controller.
 */
export const asyncHandler = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
