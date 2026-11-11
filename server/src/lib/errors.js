/** An error that is safe to show to the client. `code` is a stable key the web app translates. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHORIZED') => new HttpError(401, code);
export const forbidden = (code = 'FORBIDDEN') => new HttpError(403, code);
export const notFound = (code = 'NOT_FOUND') => new HttpError(404, code);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);

/** Wrap an async route handler so thrown errors reach the error middleware. */
export const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

/** Validate `data` with a zod schema; throw a 400 listing the bad fields. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('VALIDATION', 'Some fields are invalid', fields);
  }
  return result.data;
}
