const express = require('express');
const multer = require('multer');
const {
  sendMail,
  saveDraft,
  getDrafts,
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
  getStarredMails,
  getMailStats,
  markMailAsImportant,
  markMailAsStarred,
  snoozeMail,
  addReplyToMail,
  checkMailAddress,
  setupMailAddress,
  testMailgunConfig,
  checkMailAuthentication,
  createMailbox,
  listMailboxes,
  testWebhook,
  handleMailgunWebhook,
  cleanupTrashMails,
  manualCleanupTrash,
  fixGmailAttachmentUrls,
  scheduleMailForLater,
  getScheduledMails,
  cancelScheduledMail,
  updateScheduledMail
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
// GET endpoint for testing - webhook'un çalışıp çalışmadığını kontrol etmek için
router.get('/webhook', (req, res) => {
  console.log('Webhook GET test request received');
  res.status(200).json({ 
    message: 'Webhook endpoint is working',
    method: 'GET',
    timestamp: new Date().toISOString()
  });
});

// OPTIONS için CORS preflight desteği
router.options('/webhook', (req, res) => {
  console.log('Webhook OPTIONS preflight request received');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.status(200).end();
});

// multipart/form-data ve application/x-www-form-urlencoded formatlarını destekle
router.post('/webhook', upload.any(), handleMailgunWebhook);

// Mail gönderme
router.post('/send', isAuthenticated, upload.array('attachments', 5), sendMail);

// Taslak kaydetme
router.post('/save-draft', isAuthenticated, upload.array('attachments', 5), saveDraft);

// Taslakları getir
router.get('/drafts', isAuthenticated, getDrafts);

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

// Yıldızlı mailleri getir
router.get('/starred/list', isAuthenticated, getStarredMails);

// Mail istatistikleri
router.get('/stats/overview', isAuthenticated, getMailStats);

// Mail'i önemli olarak işaretle
router.patch('/:id/important', isAuthenticated, markMailAsImportant);

// Mail'i yıldızlı olarak işaretle
router.patch('/:id/starred', isAuthenticated, markMailAsStarred);

// Mail'i ertele
router.patch('/:id/snooze', isAuthenticated, snoozeMail);

// Mail'e cevap ekle
router.post('/:id/reply', isAuthenticated, upload.array('attachments', 5), addReplyToMail);

// Mail adresini kontrol et
router.post('/check-address', isAuthenticated, checkMailAddress);

// Mail adresini ayarla ve Mailgun route oluştur
router.post('/setup-address', isAuthenticated, setupMailAddress);

// Mailgun yapılandırmasını test et
router.get('/test-config', isAuthenticated, testMailgunConfig);

// Mail authentication durumunu kontrol et (DKIM, DMARC, SPF)
router.get('/check-authentication', isAuthenticated, checkMailAuthentication);

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

// Planlı mail endpoint'leri
router.post('/schedule', isAuthenticated, upload.array('attachments', 5), scheduleMailForLater);
router.get('/scheduled/list', isAuthenticated, getScheduledMails);
router.post('/:id/cancel-schedule', isAuthenticated, cancelScheduledMail);
router.patch('/:id/update-schedule', isAuthenticated, upload.array('attachments', 5), updateScheduledMail);

module.exports = router;
