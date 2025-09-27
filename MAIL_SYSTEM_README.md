# Mail Sistemi Kurulumu ve Kullanımı

Bu proje, Mailgun entegrasyonu ile tam özellikli bir mail sistemi içerir.

## Özellikler

### Mail Sistemi
- ✅ Gelen kutusu, gönderilenler, taslaklar, spam, çöp kutusu, arşiv klasörleri
- ✅ Mail gönderme ve alma
- ✅ Mail okundu/okunmadı işaretleme
- ✅ Mail etiketleme sistemi
- ✅ Mail arama ve filtreleme
- ✅ Mail istatistikleri
- ✅ Mailgun entegrasyonu

### Kullanıcı Sistemi Güncellemeleri
- ✅ Mail adresi alanı (domain kontrolü ile)
- ✅ Doğum tarihi ve cinsiyet alanları
- ✅ Mail adresi benzersizlik kontrolü

## Kurulum

### 1. Bağımlılıkları Yükleyin
```bash
npm install
```

### 2. Environment Variables
`.env` dosyanızı oluşturun ve aşağıdaki değişkenleri ekleyin:

```env
# Database
MONGO_URL=mongodb://localhost:27017/your-database-name

# JWT Secrets
ACCESS_TOKEN_SECRET=your-access-token-secret
REFRESH_TOKEN_SECRET=your-refresh-token-secret
JWT_SECRET_KEY=your-jwt-secret-key

# Mailgun Configuration
MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=your-domain.com
MAILGUN_DOMAIN_URL=https://api.mailgun.net

# Mail Domain (for user mail addresses)
MAIL_DOMAIN=mailaderim.com

# Server Configuration
PORT=3040
NODE_ENV=development
```

### 3. Mailgun Kurulumu
1. [Mailgun](https://www.mailgun.com/) hesabı oluşturun
2. Domain'inizi doğrulayın
3. API key'inizi alın
4. Environment variables'ları güncelleyin

## API Endpoints

### Auth Endpoints
```
POST /v1/auth/register
POST /v1/auth/login
GET /v1/auth/me
POST /v1/auth/edit-profile
```

### Mail Endpoints
```
POST /v1/mail/send              # Mail gönder
GET /v1/mail/inbox              # Gelen kutularını getir
GET /v1/mail/:id                # Mail detayını getir
PATCH /v1/mail/:id/read         # Mail okundu/okunmadı işaretle
PATCH /v1/mail/:id/move         # Mail'i klasöre taşı
DELETE /v1/mail/:id             # Mail'i sil
PATCH /v1/mail/:id/labels       # Mail'e etiket ekle/çıkar
GET /v1/mail/stats/overview     # Mail istatistikleri
POST /v1/mail/check-address     # Mail adresini kontrol et
```

## Kullanım Örnekleri

### 1. Kullanıcı Kaydı (Mail Adresi ile)
```javascript
POST /v1/auth/register
{
  "name": "Ahmet",
  "surname": "Yılmaz",
  "email": "ahmet@example.com",
  "password": "password123",
  "birthDate": "1990-01-01",
  "gender": "male",
  "mailAddress": "ahmet@mailaderim.com"
}
```

### 2. Mail Gönderme
```javascript
POST /v1/mail/send
{
  "to": ["alici@example.com"],
  "subject": "Test Mail",
  "content": "Bu bir test mailidir.",
  "htmlContent": "<h1>Bu bir test mailidir.</h1>",
  "cc": ["kopya@example.com"],
  "labels": ["work", "important"]
}
```

### 3. Gelen Kutusunu Getirme
```javascript
GET /v1/mail/inbox?page=1&limit=20&folder=inbox&search=test&isRead=false
```

### 4. Mail'i Klasöre Taşıma
```javascript
PATCH /v1/mail/64a1b2c3d4e5f6789012345/move
{
  "folder": "archive"
}
```

### 5. Mail'e Etiket Ekleme
```javascript
PATCH /v1/mail/64a1b2c3d4e5f6789012345/labels
{
  "action": "add",
  "label": "important"
}
```

## Mail Klasörleri

- **inbox**: Gelen kutusu
- **sent**: Gönderilenler
- **drafts**: Taslaklar
- **spam**: Spam
- **trash**: Çöp kutusu
- **archive**: Arşiv

## Mail Etiketleri

- **work**: İş
- **personal**: Kişisel
- **important**: Önemli
- **meeting**: Toplantı
- **shopping**: Alışveriş
- **social**: Sosyal
- **updates**: Güncellemeler
- **forums**: Forumlar
- **promotions**: Promosyonlar

## Güvenlik

- Mail adresleri sadece belirtilen domain ile oluşturulabilir
- Mail adresi benzersizlik kontrolü
- JWT token tabanlı kimlik doğrulama
- Mailgun webhook güvenliği

## Notlar

- Mail adresleri otomatik olarak küçük harfe çevrilir
- Mail gönderimi Mailgun üzerinden yapılır
- Tüm mail işlemleri kullanıcı bazlıdır
- Mail istatistikleri gerçek zamanlı olarak hesaplanır
