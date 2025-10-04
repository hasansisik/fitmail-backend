const express = require('express');
const {
  sendMail,
  getInbox,
  getMailById,
  toggleReadStatus,
  moveToFolder,
  deleteMail,
  manageLabels,
  getMailStats,
  checkMailAddress,
  setupMailAddress,
  testMailgunConfig,
  createMailbox,
  listMailboxes,
  testWebhook,
  handleMailgunWebhook
} = require('../controllers/mail');
const { isAuthenticated } = require('../middleware/authMiddleware');

const router = express.Router();

// Mailgun webhook - gelen mailleri almak için (authentication yok!)
router.post('/webhook', express.json(), handleMailgunWebhook);

// Mail gönderme
router.post('/send', isAuthenticated, sendMail);

// Gelen kutularını getir
router.get('/inbox', isAuthenticated, getInbox);

// Mail detayını getir
router.get('/:id', isAuthenticated, getMailById);

// Mail'i okundu/okunmadı olarak işaretle
router.patch('/:id/read', isAuthenticated, toggleReadStatus);

// Mail'i klasöre taşı
router.patch('/:id/move', isAuthenticated, moveToFolder);

// Mail'i sil
router.delete('/:id', isAuthenticated, deleteMail);

// Mail'e etiket ekle/çıkar
router.patch('/:id/labels', isAuthenticated, manageLabels);

// Mail istatistikleri
router.get('/stats/overview', isAuthenticated, getMailStats);

// Mail adresini kontrol et
router.post('/check-address', isAuthenticated, checkMailAddress);

// Mail adresini ayarla ve Mailgun route oluştur
router.post('/setup-address', isAuthenticated, setupMailAddress);

// Mailgun yapılandırmasını test et
router.get('/test-config', isAuthenticated, testMailgunConfig);

// Mailbox oluştur
router.post('/create-mailbox', isAuthenticated, createMailbox);

// Mevcut mailbox'ları listele
router.get('/list-mailboxes', isAuthenticated, listMailboxes);

// Webhook test endpoint'i
router.post('/test-webhook', isAuthenticated, testWebhook);

module.exports = router;
