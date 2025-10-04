const axios = require('axios');

// Test mailbox oluşturma
const testCreateMailbox = async () => {
  try {
    const testData = {
      email: 'hasan@gozdedijital.xyz'
    };

    console.log('Mailbox oluşturuluyor...');
    console.log('Test Data:', testData);

    const response = await axios.post('http://localhost:5003/v1/mail/create-mailbox', testData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Gerçek token ile değiştirin
      }
    });

    console.log('Mailbox oluşturma response:', response.data);
  } catch (error) {
    console.error('Mailbox oluşturma error:', error.response?.data || error.message);
  }
};

// Test mailbox listesi
const testListMailboxes = async () => {
  try {
    console.log('Mailbox listesi alınıyor...');

    const response = await axios.get('http://localhost:5003/v1/mail/list-mailboxes', {
      headers: {
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Gerçek token ile değiştirin
      }
    });

    console.log('Mailbox listesi:', response.data);
  } catch (error) {
    console.error('Mailbox listesi error:', error.response?.data || error.message);
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
    console.error('Domain durumu error:', error.response?.data || error.message);
  }
};

// Test webhook
const testWebhook = async () => {
  try {
    const testData = {
      recipient: 'hasan@gozdedijital.xyz',
      sender: 'test@gmail.com',
      subject: 'Test Mail - Mailbox Test',
      content: 'Bu bir test mailidir. Mailbox oluşturuldu mu kontrol ediyoruz.'
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
    console.error('Test webhook error:', error.response?.data || error.message);
  }
};

// Test fonksiyonlarını çalıştır
console.log('=== Mailgun Mailbox Test ===\n');

// Önce domain durumunu kontrol et
testDomainStatus().then(() => {
  console.log('\n=== Mailbox Listesi ===\n');
  // Mevcut mailbox'ları listele
  return testListMailboxes();
}).then(() => {
  console.log('\n=== Mailbox Oluşturma ===\n');
  // Mailbox oluştur
  return testCreateMailbox();
}).then(() => {
  console.log('\n=== Webhook Test ===\n');
  // Webhook test et
  return testWebhook();
}).then(() => {
  console.log('\nTest tamamlandı!');
}).catch(error => {
  console.error('Test sırasında hata:', error);
});
