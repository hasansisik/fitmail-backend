const express = require('express');
const multer = require('multer');
const {
  sendMail,
  getInbox,
  getMailById,
  toggleReadStatus,
  moveToFolder,
  deleteMail,
  manageLabels,
  moveToCategory,
  removeFromCategory,
  getMailsByCategory,
  getMailsByLabelCategory,
  getMailStats,
  markMailAsImportant,
  markMailAsStarred,
  snoozeMail,
  addReplyToMail,
  checkMailAddress,
  setupMailAddress,
  testMailgunConfig,
  createMailbox,
  listMailboxes,
  testWebhook,
  handleMailgunWebhook,
  cleanupTrashMails,
  manualCleanupTrash,
  fixGmailAttachmentUrls
} = require('../controllers/mail');
const { isAuthenticated } = require('../middleware/authMiddleware');

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Maximum 5 files
  }
});

const router = express.Router();

// Mailgun webhook - gelen mailleri almak için (authentication yok!)
// multipart/form-data ve application/x-www-form-urlencoded formatlarını destekle
router.post('/webhook', upload.any(), handleMailgunWebhook);

// Mail gönderme
router.post('/send', isAuthenticated, upload.array('attachments', 5), sendMail);

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

// Mail'i kategoriye taşı
router.patch('/:id/move-to-category', isAuthenticated, moveToCategory);

// Mail'den kategoriyi kaldır
router.patch('/:id/remove-from-category', isAuthenticated, removeFromCategory);

// Kategoriye göre mailleri getir
router.get('/category/:category', isAuthenticated, getMailsByCategory);

// Label kategorisine göre mailleri getir
router.get('/label-category/:category', isAuthenticated, getMailsByLabelCategory);

// Mail istatistikleri
router.get('/stats/overview', isAuthenticated, getMailStats);

// Mail'i önemli olarak işaretle
router.patch('/:id/important', isAuthenticated, markMailAsImportant);

// Mail'i yıldızlı olarak işaretle
router.patch('/:id/starred', isAuthenticated, markMailAsStarred);

// Mail'i ertele
router.patch('/:id/snooze', isAuthenticated, snoozeMail);

// Mail'e cevap ekle
router.post('/:id/reply', isAuthenticated, addReplyToMail);

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

// Get mail by ID
router.get('/:id', isAuthenticated, getMailById);

// Webhook test endpoint'i (authentication yok - test için)
router.post('/test-webhook', express.json(), testWebhook);

// Çöp kutusu temizleme endpoint'i
router.post('/cleanup-trash', isAuthenticated, manualCleanupTrash);

// Gmail attachment URL'lerini düzelt
router.post('/fix-gmail-urls', isAuthenticated, fixGmailAttachmentUrls);

module.exports = router;
