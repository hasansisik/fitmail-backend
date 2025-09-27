const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");

const isAuthenticated = async function (req, res, next) {
  if (!req.headers["authorization"]) {
    return next(createHttpError.Unauthorized());
  }
  const bearerToken = req.headers["authorization"];
  const token = bearerToken.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, payload) => {
    if (err) {
      return next(createHttpError.Unauthorized());
    }
    req.user = payload;
    next();
  });
};

const isUser = async function (req, res, next) {
  if (!req.user || req.user.role !== "user") {
    return next(createHttpError.Unauthorized());
  }
  next();
};

const isAdmin = async function (req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return next(createHttpError.Unauthorized());
  }
  next();
};

// Dashboard middleware - checks if user is authenticated and has admin role
const isDashboardAccess = async function (req, res, next) {
  if (!req.user) {
    return next(createHttpError.Unauthorized("Giriş yapmanız gerekiyor"));
  }
  
  if (req.user.role !== "admin") {
    return next(createHttpError.Forbidden("Bu sayfaya erişim yetkiniz bulunmamaktadır"));
  }
  
  next();
};

module.exports = {
  isAuthenticated,
  isUser,
  isAdmin,
  isDashboardAccess
};
