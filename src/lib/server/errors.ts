export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, "UNAUTHENTICATED", "Sign in required.");
export const forbidden = (msg = "You do not have permission to do this.") => new AppError(403, "FORBIDDEN", msg);
export const badRequest = (msg: string) => new AppError(400, "BAD_REQUEST", msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
