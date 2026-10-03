export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} message user-facing message (Bangla preferred)
   * @param {string} [code] machine-readable code for the client
   */
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}

export const badRequest = (msg, code = 'BAD_REQUEST') => new AppError(400, msg, code);
export const unauthorized = (msg = 'লগইন প্রয়োজন', code = 'UNAUTHORIZED') => new AppError(401, msg, code);
export const forbidden = (msg = 'অনুমতি নেই', code = 'FORBIDDEN') => new AppError(403, msg, code);
export const notFound = (msg = 'খুঁজে পাওয়া যায়নি', code = 'NOT_FOUND') => new AppError(404, msg, code);
export const conflict = (msg, code = 'CONFLICT') => new AppError(409, msg, code);
