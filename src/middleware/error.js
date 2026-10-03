import { isProd } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Something went wrong';

  if (err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = 'অবৈধ আইডি';
  }
  if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'এই তথ্য আগে থেকেই আছে';
  }

  if (status >= 500) {
    console.error(err);
    if (isProd) message = 'সার্ভারে সমস্যা হয়েছে, একটু পরে চেষ্টা করো';
  }

  res.status(status).json({ error: { code, message, details: err.details } });
}
