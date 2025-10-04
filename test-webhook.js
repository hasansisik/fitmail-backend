const axios = require('axios');

// Test webhook endpoint'i
const testWebhook = async () => {
  try {
    const testData = {
      recipient: 'test@gozdedijital.xyz', // Test edilecek mail adresi
      sender: 'sender@example.com',
      subject: 'Test Mail - Webhook Test',
      content: 'Bu bir test mailidir. Webhook sistemi çalışıyor mu kontrol ediyoruz.'
    };

    console.log('Test webhook verisi gönderiliyor...');
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

// Gerçek webhook endpoint'ini test et
const testRealWebhook = async () => {
  try {
    const webhookData = {
      recipient: 'test@gozdedijital.xyz',
      sender: 'test-sender@example.com',
      subject: 'Gerçek Webhook Test',
      'body-plain': 'Bu gerçek webhook testidir.',
      'body-html': '<p>Bu gerçek webhook testidir.</p>',
      timestamp: Math.floor(Date.now() / 1000),
      'Message-Id': `test-${Date.now()}@gozdedijital.xyz`
    };

    console.log('Gerçek webhook endpoint test ediliyor...');
    console.log('Webhook Data:', webhookData);

    const response = await axios.post('http://localhost:5003/v1/mail/webhook', webhookData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Webhook response:', response.data);
  } catch (error) {
    console.error('Webhook error:', error.response?.data || error.message);
  }
};

// Test fonksiyonlarını çalıştır
console.log('=== Mailgun Webhook Test ===\n');

// Önce test endpoint'ini dene
testWebhook().then(() => {
  console.log('\n=== Gerçek Webhook Test ===\n');
  // Sonra gerçek webhook'u dene
  return testRealWebhook();
}).then(() => {
  console.log('\nTest tamamlandı!');
}).catch(error => {
  console.error('Test sırasında hata:', error);
});
