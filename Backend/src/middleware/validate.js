export const validate = (schema, source = 'query') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters', details: result.error.issues },
    });
  }
  res.locals.validated = res.locals.validated ?? {};
  res.locals.validated[source] = result.data;
  return next();
};
