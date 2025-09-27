# Mail Sistemi Sorun Giderme Rehberi

## Yaygın Hatalar ve Çözümleri

### 1. "Parameter 'key' is required" Hatası

**Hata Mesajı:**
```
Error: Parameter "key" is required
    at new e (/Users/hasan/Desktop/Nodejs-template-main/node_modules/mailgun.js/mailgun.node.js:2:32709)
```

**Çözüm:**
Bu hata, Mailgun API key'inin environment variables'da tanımlanmamış olmasından kaynaklanır.

1. `.env` dosyanızı oluşturun veya güncelleyin:
```env
MAILGUN_API_KEY=your-mailgun-api-key-here
MAILGUN_DOMAIN=your-domain.com
MAILGUN_DOMAIN_URL=https://api.mailgun.net
MAIL_DOMAIN=mailaderim.com
```

2. Mailgun hesabınızdan API key'inizi alın:
   - [Mailgun Dashboard](https://app.mailgun.com/) → Settings → API Keys
   - Private API key'i kopyalayın

3. Uygulamayı yeniden başlatın:
```bash
npm start
```

### 2. Mailgun Yapılandırmasını Test Etme

Mailgun yapılandırmasının doğru olup olmadığını test etmek için:

```bash
GET /v1/mail/test-config
```

Bu endpoint size şu bilgileri verir:
- Mailgun yapılandırması başarılı mı?
- Domain durumu nedir?
- Hata detayları varsa neler?

### 3. Mail Gönderme Hataları

**"Mail servisi yapılandırılmamış" Hatası:**
- Environment variables'ları kontrol edin
- Mailgun API key'inin doğru olduğundan emin olun
- Domain'in doğrulandığından emin olun

**"Mail gönderilemedi" Hatası:**
- Alıcı email adresinin geçerli olduğundan emin olun
- Mailgun hesabınızda yeterli kredi olduğundan emin olun
- Domain'in aktif olduğundan emin olun

### 4. Environment Variables Kontrolü

Gerekli environment variables'ları kontrol etmek için:

```bash
# .env dosyasının varlığını kontrol edin
ls -la .env

# Environment variables'ları kontrol edin
echo $MAILGUN_API_KEY
echo $MAILGUN_DOMAIN
```

### 5. Mailgun Domain Doğrulama

1. Mailgun Dashboard'a gidin
2. Domains sekmesine tıklayın
3. Domain'inizin durumunu kontrol edin
4. DNS kayıtlarının doğru olduğundan emin olun

### 6. Test Mail Gönderme

Mailgun yapılandırmasını test etmek için:

```javascript
POST /v1/mail/send
{
  "to": ["test@example.com"],
  "subject": "Test Mail",
  "content": "Bu bir test mailidir."
}
```

### 7. Debug Modu

Daha detaylı hata mesajları için:

```javascript
// services/mailgun.service.js dosyasında
console.log('Mailgun API Key:', process.env.MAILGUN_API_KEY ? 'Set' : 'Not Set');
console.log('Mailgun Domain:', process.env.MAILGUN_DOMAIN);
```

### 8. Yaygın Çözümler

1. **Uygulamayı yeniden başlatın:**
   ```bash
   npm start
   ```

2. **Node modules'ları yeniden yükleyin:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Environment variables'ları kontrol edin:**
   ```bash
   cat .env
   ```

4. **Mailgun hesabınızı kontrol edin:**
   - API key'in aktif olduğundan emin olun
   - Domain'in doğrulandığından emin olun
   - Hesabınızda yeterli kredi olduğundan emin olun

### 9. Log Kontrolü

Uygulama loglarını kontrol etmek için:

```bash
# Terminal'de uygulamayı çalıştırın ve logları takip edin
npm start
```

### 10. Mailgun Webhook Ayarları

Webhook'ları ayarlamak için:

1. Mailgun Dashboard → Webhooks
2. Webhook URL'inizi ekleyin: `https://yourdomain.com/v1/mail/webhook`
3. Event'leri seçin: delivered, failed, bounced, etc.

## Başarılı Kurulum Kontrolü

Kurulumun başarılı olduğunu kontrol etmek için:

1. ✅ Uygulama hatasız başlıyor
2. ✅ `/v1/mail/test-config` endpoint'i başarılı yanıt veriyor
3. ✅ Test mail gönderebiliyorsunuz
4. ✅ Mail adresi kontrolü çalışıyor

## Destek

Sorun devam ederse:
1. Log dosyalarını kontrol edin
2. Mailgun Dashboard'da hesap durumunu kontrol edin
3. Environment variables'ları tekrar kontrol edin
4. Uygulamayı yeniden başlatın
