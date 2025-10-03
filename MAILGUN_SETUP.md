# Mailgun Entegrasyonu Kurulum Rehberi

## 🔧 Yapılandırma

### 1. Environment Variables (.env dosyasına ekleyin)

```env
# MongoDB
MONGO_URI=your_mongodb_uri

# JWT Secrets
ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Mailgun Configuration
MAILGUN_API_KEY=72715e1259cf2d85b2c19523bb423d35-8b22cbee-131444d9
MAILGUN_DOMAIN=gozdedijital.xyz
MAILGUN_SENDING_KEY=79930fe645284a974baa1b701606bc21-8b22cbee-48eb77a1
MAILGUN_WEBHOOK_SIGNING_KEY=92d44850a589dea6a40bb971f9351f46
MAILGUN_VERIFICATION_PUBLIC_KEY=pubkey-9613e23c103d0fa6caba037bda792462
MAILGUN_DOMAIN_URL=https://api.mailgun.net

# Email Configuration
EMAIL_FROM=noreply@gozdedijital.xyz
EMAIL_FROM_NAME=Gözde Dijital

# Server
PORT=5003
```

---

## 🚀 Nasıl Çalışır?

### 1. **Kullanıcı Kaydı**
Kullanıcı `hasan@gozdedijital.xyz` ile kayıt olduğunda:

1. **Backend** kullanıcıyı MongoDB'ye kaydeder
2. **Mailgun Route** oluşturulur:
   - Expression: `match_recipient("hasan@gozdedijital.xyz")`
   - Action: Gelen mailleri webhook'a forward eder
3. **Hoşgeldin maili** gönderilir

### 2. **Mail Gönderme**
Kullanıcı mail gönderdiğinde:

1. Frontend → Redux action → Backend `/v1/mail/send`
2. Mail MongoDB'ye kaydedilir
3. **Mailgun API** ile mail gönderilir
4. Mail durumu `sent` olarak güncellenir

### 3. **Mail Alma**
Başka biri `hasan@gozdedijital.xyz`'e mail gönderdiğinde:

1. **Mailgun** maili alır
2. Route ile webhook'a forward eder: `http://localhost:5003/v1/mail/webhook`
3. Backend webhook'u işler
4. Mail MongoDB'ye kaydedilir
5. Kullanıcının inbox'ına eklenir

---

## 📝 API Endpoints

### Webhook Endpoint (Public - No Auth)
```
POST /v1/mail/webhook
```
Mailgun tarafından gelen mailleri almak için kullanılır.

**Request Body (Mailgun gönderir):**
```json
{
  "recipient": "hasan@gozdedijital.xyz",
  "sender": "aydin@birimajans.com",
  "from": "AYDIN GUNES <aydin@birimajans.com>",
  "subject": "Hello World",
  "body-plain": "This is a test message",
  "body-html": "<p>This is a test message</p>",
  "timestamp": 1234567890,
  "Message-Id": "<20230101120000.1.ABCDEF@gozdedijital.xyz>"
}
```

---

## 🔐 Mailgun Dashboard Ayarları

### 1. **Domain Settings**
- Domain: `gozdedijital.xyz`
- Type: `Sending & Receiving`
- Status: `Active`

### 2. **Webhook Settings**
Mailgun Dashboard → Sending → Webhooks:

- **Event**: `Incoming Messages`
- **URL**: `http://your-server.com:5003/v1/mail/webhook` (veya ngrok URL)
- **Signing Key**: `92d44850a589dea6a40bb971f9351f46`

### 3. **Routes (Otomatik Oluşturulur)**
Kullanıcı kaydı sırasında backend otomatik oluşturur:

```javascript
{
  priority: 0,
  description: "Route for hasan@gozdedijital.xyz",
  expression: "match_recipient(\"hasan@gozdedijital.xyz\")",
  action: [
    "forward(\"http://localhost:5003/v1/mail/webhook\")",
    "store()"
  ]
}
```

---

## 🧪 Test Etme

### 1. **Kullanıcı Kaydı Testi**
```bash
# Frontend'de kayıt ol
# Email: hasan
# Domain: @gozdedijital.xyz
# Sonuç: hasan@gozdedijital.xyz
```

Backend loglarını kontrol edin:
```
Mailgun route created for: hasan@gozdedijital.xyz
Welcome email sent to: hasan@gozdedijital.xyz
```

### 2. **Mail Gönderme Testi**
```bash
curl -X POST http://localhost:5003/v1/mail/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "aydin@birimajans.com",
    "subject": "Test Mail",
    "content": "Bu bir test mailidir"
  }'
```

### 3. **Mail Alma Testi**
Mailgun Dashboard → Send Test Message:
- To: `hasan@gozdedijital.xyz`
- Subject: `Test Mail`
- Body: `Bu bir test mailidir`

Backend webhook loglarını kontrol edin:
```
Mailgun webhook received: {...}
Processing mail: { recipient: 'hasan@gozdedijital.xyz', sender: '...', subject: 'Test Mail' }
Mail saved successfully: 507f1f77bcf86cd799439011
```

---

## 🔍 Hata Ayıklama

### Webhook çalışmıyor?
1. **Ngrok kullanın** (localhost webhook çalışmaz):
```bash
ngrok http 5003
# URL: https://abc123.ngrok.io
# Mailgun webhook URL: https://abc123.ngrok.io/v1/mail/webhook
```

2. **Webhook loglarını kontrol edin**:
```bash
# Backend terminal
Mailgun webhook received: {...}
```

3. **Mailgun logs kontrol edin**:
   - Dashboard → Sending → Logs
   - Webhook delivery status

### Route oluşturulmadı?
```bash
# Manuel route oluştur
curl -X POST https://api.mailgun.net/v3/routes \
  -u "api:72715e1259cf2d85b2c19523bb423d35-8b22cbee-131444d9" \
  -F "priority=0" \
  -F "description=Route for hasan@gozdedijital.xyz" \
  -F "expression=match_recipient(\"hasan@gozdedijital.xyz\")" \
  -F "action=forward(\"https://your-webhook-url.ngrok.io/v1/mail/webhook\")" \
  -F "action=store()"
```

---

## 📊 Mailgun API Kullanımı

### Mail Gönderme (Basit)
```javascript
const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: "api",
  key: "72715e1259cf2d85b2c19523bb423d35-8b22cbee-131444d9",
  url: "https://api.mailgun.net"
});

const data = await mg.messages.create("gozdedijital.xyz", {
  from: "Fitmail <noreply@gozdedijital.xyz>",
  to: ["hasan@gozdedijital.xyz"],
  subject: "Test Mail",
  text: "Bu bir test mailidir",
  html: "<p>Bu bir test mailidir</p>"
});
```

### Route Oluşturma
```javascript
const routeData = {
  priority: 0,
  description: `Route for hasan@gozdedijital.xyz`,
  expression: `match_recipient("hasan@gozdedijital.xyz")`,
  action: [
    `forward("https://your-webhook-url.ngrok.io/v1/mail/webhook")`,
    'store()'
  ]
};

const response = await mg.routes.create(routeData);
```

---

## ✅ Yapılan Değişiklikler

### Backend
1. ✅ `mailgun.service.js` - Mailgun entegrasyonu
2. ✅ `auth.js` - Kayıt sırasında route oluşturma ve hoşgeldin maili
3. ✅ `mail.js` - Webhook handler eklendi
4. ✅ `routers/mail.js` - Webhook endpoint eklendi
5. ✅ Domain: `fitmail.com` → `gozdedijital.xyz`

### Frontend
1. ✅ `register-form.tsx` - Domain: `@gozdedijital.xyz`
2. ✅ `login-form.tsx` - Domain: `@gozdedijital.xyz`
3. ✅ `step3-email.tsx` - Domain görüntüsü güncellendi

---

## 🎯 Özellikler

- ✉️ **Otomatik Mail Adresi Oluşturma**: Kayıt sırasında `hasan@gozdedijital.xyz`
- 🔄 **Otomatik Route Oluşturma**: Her kullanıcı için Mailgun route
- 📧 **Hoşgeldin Maili**: Kayıt sonrası otomatik gönderim
- 📥 **Gelen Mail**: Webhook ile otomatik inbox'a ekleme
- 📤 **Mail Gönderme**: Mailgun API ile güvenli gönderim
- 🔒 **Güvenli**: Webhook authentication ve signing key

---

## 🆘 Destek

Sorun yaşarsanız:
1. Backend logs kontrol edin
2. Mailgun Dashboard → Logs kontrol edin
3. Ngrok URL'ini webhook'a ekleyin
4. Environment variables doğru mu kontrol edin

**Test Mail Gönder:**
```bash
curl -X POST https://api.mailgun.net/v3/gozdedijital.xyz/messages \
  -u "api:72715e1259cf2d85b2c19523bb423d35-8b22cbee-131444d9" \
  -F "from=Test <test@gozdedijital.xyz>" \
  -F "to=hasan@gozdedijital.xyz" \
  -F "subject=Test" \
  -F "text=Test message"
```

