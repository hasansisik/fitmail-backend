const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");

const isAuthenticated = async function (req, res, next) {
  // Prefer HttpOnly cookie first, then Authorization header as fallback
  const cookieToken = req.cookies && req.cookies.accessToken;
  const headerAuth = req.headers["authorization"];
  const headerToken = headerAuth ? headerAuth.split(" ")[1] : null;
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.",
      requiresLogout: true
    });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: "Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.",
        requiresLogout: true
      });
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
