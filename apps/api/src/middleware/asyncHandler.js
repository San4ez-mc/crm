// Обгортка для async route-хендлерів — проброс помилок у next(err) для errorHandler.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
