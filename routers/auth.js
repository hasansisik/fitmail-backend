const express = require('express');
const {register,googleRegister,googleAuth,login,googleLogin,getMyProfile,getAllUsers,logout,verifyRecoveryEmail,forgotPassword,resetPassword,verifyEmail,againEmail,editProfile,verifyPassword,changePassword,updateSettings,deleteAccount,deleteUser,updateUserRole,updateUserStatus,checkEmailAvailability,checkPremiumCode,enable2FA,verify2FA,disable2FA,verify2FALogin,get2FAStatus,switchActive,getAllActiveSessions,removeSession} = require('../controllers/auth');
const {isAuthenticated, isAdmin} = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register',register);
router.post('/google-register',googleRegister);
router.post('/google-auth',googleAuth);
router.post('/login',login);
router.post('/google-login',googleLogin);
router.post('/check-email', checkEmailAvailability);
router.post('/check-premium-code', checkPremiumCode);
router.get("/me", isAuthenticated, getMyProfile);
router.get('/logout',isAuthenticated,logout);
router.post('/verify-recovery-email', verifyRecoveryEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-email', verifyEmail);
router.post('/again-email', againEmail);
router.post('/edit-profile',isAuthenticated, editProfile);
router.post('/verify-password',isAuthenticated, verifyPassword);
router.post('/change-password',isAuthenticated, changePassword);
router.post('/update-settings',isAuthenticated, updateSettings);
// Get all active sessions (users with valid tokens)
// Accepts POST with email list in body, or GET for backward compatibility
router.get('/sessions', isAuthenticated, getAllActiveSessions);
router.post('/sessions', isAuthenticated, getAllActiveSessions);
// Remove a specific session (delete all tokens for a user)
router.post('/remove-session', isAuthenticated, removeSession);
// Active account switch (requires being authenticated by any account)
router.post('/switch-active', isAuthenticated, switchActive);
router.delete('/delete-account',isAuthenticated, deleteAccount);

// 2FA routes
router.post('/2fa/enable', isAuthenticated, enable2FA);
router.post('/2fa/verify', isAuthenticated, verify2FA);
router.post('/2fa/disable', isAuthenticated, disable2FA);
router.post('/2fa/verify-login', verify2FALogin);
router.get('/2fa/status', isAuthenticated, get2FAStatus);

// Admin only routes
router.get('/users', isAuthenticated, isAdmin, getAllUsers);
router.delete('/users/:id', isAuthenticated, isAdmin, deleteUser);
router.patch('/users/:id/role', isAuthenticated, isAdmin, updateUserRole);
router.patch('/users/:id/status', isAuthenticated, isAdmin, updateUserStatus);

module.exports = router;
