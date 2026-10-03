/**
 * Validates req[source] with a zod schema and replaces it with the parsed value.
 * Express 5 makes req.query a getter, so parsed query goes to req.validatedQuery.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const err = new Error('ইনপুট সঠিক নয়');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw err;
  }
  if (source === 'query') req.validatedQuery = result.data;
  else req[source] = result.data;
  next();
};
