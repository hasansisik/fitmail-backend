const express = require('express');
const {
  getAllPremiums,
  getPremiumById,
  createPremium,
  updatePremium,
  deletePremium,
  togglePremiumStatus,
  getPremiumByCode
} = require('../controllers/premium');
const { isAuthenticated } = require('../middleware/authMiddleware');

const router = express.Router();

// Tüm premium planları getir
router.get('/', isAuthenticated, getAllPremiums);

// Kod ile premium plan getir (daha spesifik route önce gelmeli)
router.get('/code/:code', isAuthenticated, getPremiumByCode);

// Premium plan detayını getir
router.get('/:id', isAuthenticated, getPremiumById);

// Yeni premium plan oluştur (sadece admin)
router.post('/', isAuthenticated, createPremium);

// Premium plan güncelle (sadece admin)
router.put('/:id', isAuthenticated, updatePremium);

// Premium plan sil (sadece admin)
router.delete('/:id', isAuthenticated, deletePremium);

// Premium plan durumunu değiştir (sadece admin)
router.patch('/:id/toggle', isAuthenticated, togglePremiumStatus);

module.exports = router;
