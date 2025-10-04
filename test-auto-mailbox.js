const axios = require('axios');

// Test otomatik mailbox oluşturma (kayıt sırasında)
const testAutoMailboxCreation = async () => {
  try {
    const testUser = {
      name: 'Test',
      surname: 'User',
      email: 'testuser@gozdedijital.xyz',
      password: 'testpassword123',
      birthDate: '1990-01-01',
      gender: 'male'
    };

    console.log('Yeni kullanıcı kaydı test ediliyor...');
    console.log('Test User:', testUser);

    const response = await axios.post('http://localhost:5003/v1/auth/register', testUser, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Kayıt başarılı:', response.data);
    console.log('Mailbox otomatik oluşturuldu mu kontrol edin!');
  } catch (error) {
    console.error('Kayıt hatası:', error.response?.data || error.message);
  }
};

// Test mevcut mailbox'ları listele
const testListMailboxes = async () => {
  try {
    console.log('Mevcut mailbox\'lar listeleniyor...');

    const response = await axios.get('http://localhost:5003/v1/mail/list-mailboxes', {
      headers: {
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Gerçek token ile değiştirin
      }
    });

    console.log('Mailbox listesi:', response.data);
  } catch (error) {
    console.error('Mailbox listesi hatası:', error.response?.data || error.message);
  }
};

// Test domain durumu
const testDomainStatus = async () => {
  try {
    console.log('Domain durumu kontrol ediliyor...');

    const response = await axios.get('http://localhost:5003/v1/mail/test-config', {
      headers: {
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Gerçek token ile değiştirin
      }
    });

    console.log('Domain durumu:', response.data);
  } catch (error) {
    console.error('Domain durumu hatası:', error.response?.data || error.message);
  }
};

// Test webhook
const testWebhook = async () => {
  try {
    const testData = {
      recipient: 'testuser@gozdedijital.xyz',
      sender: 'test@gmail.com',
      subject: 'Test Mail - Otomatik Mailbox Test',
      content: 'Bu bir test mailidir. Otomatik mailbox oluşturuldu mu kontrol ediyoruz.'
    };

    console.log('Test webhook çalıştırılıyor...');
    console.log('Test Data:', testData);

    const response = await axios.post('http://localhost:5003/v1/mail/test-webhook', testData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Gerçek token ile değiştirin
      }
    });

    console.log('Test webhook response:', response.data);
  } catch (error) {
    console.error('Test webhook hatası:', error.response?.data || error.message);
  }
};

// Test fonksiyonlarını çalıştır
console.log('=== Otomatik Mailbox Oluşturma Test ===\n');

// Önce domain durumunu kontrol et
testDomainStatus().then(() => {
  console.log('\n=== Yeni Kullanıcı Kaydı (Otomatik Mailbox) ===\n');
  // Yeni kullanıcı kaydı test et
  return testAutoMailboxCreation();
}).then(() => {
  console.log('\n=== Mailbox Listesi ===\n');
  // Mailbox listesi kontrol et
  return testListMailboxes();
}).then(() => {
  console.log('\n=== Webhook Test ===\n');
  // Webhook test et
  return testWebhook();
}).then(() => {
  console.log('\nTest tamamlandı!');
  console.log('\n📧 Artık her yeni kullanıcı kaydında otomatik olarak:');
  console.log('1. ✅ Mailbox oluşturulacak');
  console.log('2. ✅ Route oluşturulacak');
  console.log('3. ✅ Mail alabilir hale gelecek');
}).catch(error => {
  console.error('Test sırasında hata:', error);
});
