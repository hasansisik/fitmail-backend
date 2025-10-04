require('dotenv').config();
const axios = require('axios');

async function recreateMailgunRoute() {
  try {
    const apiKey = process.env.MAILGUN_API_KEY;
    const webhookUrl = process.env.WEBHOOK_URL || 'https://mail-backend-mu.vercel.app/v1/mail/webhook';
    
    if (!apiKey) {
      console.error('MAILGUN_API_KEY environment variable is not set');
      return;
    }

    console.log('Recreating Mailgun route...');
    console.log('Webhook URL:', webhookUrl);

    // Mevcut route'ları kontrol et
    const routesResponse = await axios.get(`https://api.mailgun.net/v3/routes`, {
      auth: {
        username: 'api',
        password: apiKey
      }
    });

    // gozdedijital.xyz için route bul ve sil
    const gozdeRoute = routesResponse.data.items.find(route => 
      route.expression && route.expression.includes('gozdedijital.xyz')
    );

    if (gozdeRoute) {
      console.log('Found existing route:', gozdeRoute.id);
      console.log('Deleting old route...');
      
      // Eski route'u sil
      await axios.delete(`https://api.mailgun.net/v3/routes/${gozdeRoute.id}`, {
        auth: {
          username: 'api',
          password: apiKey
        }
      });
      
      console.log('✅ Old route deleted');
    }

    // Yeni route oluştur
    console.log('Creating new route...');
    const routeData = {
      priority: 0,
      description: 'General route for all @gozdedijital.xyz addresses',
      expression: 'match_recipient(".*@gozdedijital.xyz")',
      actions: [`forward("${webhookUrl}")`, 'store()']
    };

    const createResponse = await axios.post(`https://api.mailgun.net/v3/routes`, routeData, {
      auth: {
        username: 'api',
        password: apiKey
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('✅ New route created successfully!');
    console.log('Route ID:', createResponse.data.route.id);
    console.log('Actions:', createResponse.data.route.actions);

  } catch (error) {
    console.error('Error recreating Mailgun route:', error.response?.data || error.message);
  }
}

recreateMailgunRoute();
