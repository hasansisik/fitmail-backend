require('dotenv').config();
const axios = require('axios');

async function fixRouteActions() {
  try {
    const apiKey = process.env.MAILGUN_API_KEY;
    
    // Webhook URL'ini belirle - önce WEBHOOK_URL, sonra BACKEND_URL, sonra production URL
    let webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl && process.env.BACKEND_URL) {
      webhookUrl = `${process.env.BACKEND_URL}/v1/mail/webhook`;
    }
    if (!webhookUrl) {
      const prodUrl = process.env.PRODUCTION_URL || 'api.fitmail.com';
      webhookUrl = `https://${prodUrl}/v1/mail/webhook`;
    }
    
    if (!apiKey) {
      console.error('MAILGUN_API_KEY environment variable is not set');
      return;
    }

    console.log('Fixing route actions...');
    console.log('Webhook URL:', webhookUrl);

    // Mevcut route'u sil
    const routesResponse = await axios.get(`https://api.eu.mailgun.net/v3/routes`, {
      auth: {
        username: 'api',
        password: apiKey
      }
    });

    const gozdeRoute = routesResponse.data.items.find(route => 
      route.expression && route.expression.includes('fitmail.com')
    );

    if (gozdeRoute) {
      console.log('Deleting existing route:', gozdeRoute.id);
      await axios.delete(`https://api.eu.mailgun.net/v3/routes/${gozdeRoute.id}`, {
        auth: {
          username: 'api',
          password: apiKey
        }
      });
    }

    // Yeni route oluştur - form data olarak
    const formData = new URLSearchParams();
    formData.append('priority', '0');
    formData.append('description', 'General route for all @fitmail.com addresses');
    formData.append('expression', 'match_recipient(".*@fitmail.com")');
    formData.append('action', `forward("${webhookUrl}")`);
    formData.append('action', 'store()');

    console.log('Creating new route with form data...');
    const createResponse = await axios.post(`https://api.eu.mailgun.net/v3/routes`, formData, {
      auth: {
        username: 'api',
        password: apiKey
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('✅ Route created successfully!');
    console.log('Route ID:', createResponse.data.route.id);
    console.log('Actions:', createResponse.data.route.actions);

  } catch (error) {
    console.error('Error fixing route actions:', error.response?.data || error.message);
  }
}

fixRouteActions();
