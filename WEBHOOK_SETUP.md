# Mailgun Webhook Kurulumu

Bu doküman, Mailgun webhook'u ile gelen mailleri veritabanına kaydetme işleminin nasıl kurulacağını açıklar.

## 🚀 Özellikler

- ✅ Gelen mailleri otomatik olarak veritabanına kaydetme
- ✅ Mailgun webhook entegrasyonu
- ✅ Gelişmiş mail parsing (CC, BCC, HTML, Plain text)
- ✅ Kullanıcı bazlı mail filtreleme
- ✅ Test endpoint'leri

## 📋 Gereksinimler

1. **Mailgun Hesabı**: Aktif Mailgun hesabı
2. **Domain**: Doğrulanmış domain (örn: gozdedijital.xyz)
3. **Environment Variables**: Gerekli environment değişkenleri

## ⚙️ Environment Variables

```bash
# Mailgun Configuration
MAILGUN_API_KEY=your_mailgun_api_key
MAILGUN_DOMAIN=gozdedijital.xyz
MAILGUN_DOMAIN_URL=https://api.mailgun.net

# Webhook URL (Production'da gerçek URL kullanın)
WEBHOOK_URL=http://localhost:5003/v1/mail/webhook

# Email Configuration
EMAIL_FROM=noreply@gozdedijital.xyz
EMAIL_FROM_NAME=Gözde Dijital
```

## 🔧 Kurulum Adımları

### 1. Mailgun Route Oluşturma

Her kullanıcı için mail adresi oluşturulduğunda, otomatik olarak Mailgun route'u oluşturulur:

```javascript
// Kullanıcı mail adresi oluşturduğunda
const routeData = {
  priority: 0,
  description: `Route for ${email}`,
  expression: `match_recipient("${email}")`,
  action: [`forward("${webhookUrl}")`, 'store()']
};
```

### 2. Webhook Endpoint'i

Webhook endpoint'i: `POST /v1/mail/webhook`

**Önemli**: Bu endpoint authentication gerektirmez!

### 3. Test Endpoint'leri

#### Test Webhook (Authentication gerekli)
```bash
POST /v1/mail/test-webhook
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "recipient": "test@gozdedijital.xyz",
  "sender": "sender@example.com", 
  "subject": "Test Mail",
  "content": "Test içeriği"
}
```

#### Gerçek Webhook Test
```bash
POST /v1/mail/webhook
Content-Type: application/json

{
  "recipient": "test@gozdedijital.xyz",
  "sender": "test@example.com",
  "subject": "Test Mail",
  "body-plain": "Test içeriği",
  "body-html": "<p>Test içeriği</p>",
  "timestamp": 1640995200,
  "Message-Id": "test-123@gozdedijital.xyz"
}
```

## 📊 Mail Verisi Yapısı

Gelen mailler aşağıdaki yapıda veritabanına kaydedilir:

```javascript
{
  from: {
    email: "sender@example.com",
    name: "Sender Name"
  },
  to: [{
    email: "recipient@gozdedijital.xyz", 
    name: "Recipient Name"
  }],
  cc: [...], // CC alıcıları
  bcc: [...], // BCC alıcıları
  subject: "Mail Konusu",
  content: "Plain text içerik",
  htmlContent: "<p>HTML içerik</p>",
  folder: "inbox",
  status: "delivered",
  isRead: false,
  receivedAt: "2024-01-01T00:00:00.000Z",
  messageId: "unique-message-id",
  mailgunId: "mailgun-message-id",
  user: "user_object_id",
  labels: []
}
```

## 🧪 Test Etme

### 1. Test Script'i Çalıştırma

```bash
cd mail-backend
node test-webhook.js
```

### 2. Manuel Test

1. Backend'i başlatın: `npm start`
2. Test endpoint'ini çağırın
3. Veritabanında mail'in kaydedildiğini kontrol edin

### 3. Gerçek Mail Test

1. Mailgun dashboard'da route'ları kontrol edin
2. Test maili gönderin
3. Webhook log'larını kontrol edin

## 🔍 Debugging

### Log'ları İzleme

```bash
# Backend log'larını izleyin
npm start

# Webhook log'ları console'da görünecek
```

### Yaygın Sorunlar

1. **Kullanıcı bulunamadı**: `mailAddress` alanının doğru set edildiğinden emin olun
2. **Webhook ulaşmıyor**: URL'nin doğru olduğunu ve erişilebilir olduğunu kontrol edin
3. **Mail kaydedilmiyor**: Veritabanı bağlantısını ve Mail model'ini kontrol edin

## 📝 Mailgun Webhook Verisi

Mailgun aşağıdaki formatta webhook verisi gönderir:

```javascript
{
  "recipient": "user@gozdedijital.xyz",
  "sender": "sender@example.com",
  "subject": "Mail Konusu",
  "body-plain": "Plain text içerik",
  "body-html": "<p>HTML içerik</p>",
  "timestamp": 1640995200,
  "Message-Id": "unique-message-id",
  "cc": "cc@example.com",
  "bcc": "bcc@example.com"
}
```

## 🚀 Production Kurulumu

1. **HTTPS**: Webhook URL'i HTTPS olmalı
2. **Authentication**: Webhook endpoint'i public olmalı (Mailgun'dan gelecek)
3. **Error Handling**: Webhook hatalarında 200 döndürün (Mailgun tekrar deneyebilir)
4. **Rate Limiting**: Gerekirse rate limiting ekleyin
5. **Monitoring**: Webhook başarı/başarısızlık oranlarını izleyin

## 📞 Destek

Herhangi bir sorun yaşarsanız:
1. Console log'larını kontrol edin
2. Mailgun dashboard'da webhook durumunu kontrol edin
3. Veritabanı bağlantısını test edin
