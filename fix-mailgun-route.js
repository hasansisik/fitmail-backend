require('dotenv').config();
const axios = require('axios');

async function fixMailgunRoute() {
  try {
    const apiKey = process.env.MAILGUN_API_KEY;
    const webhookUrl = process.env.WEBHOOK_URL || 'https://mail-backend-mu.vercel.app/v1/mail/webhook';
    
    if (!apiKey) {
      console.error('MAILGUN_API_KEY environment variable is not set');
      return;
    }

    console.log('Fixing Mailgun route webhook URL...');
    console.log('New Webhook URL:', webhookUrl);

    // Mevcut route'ları kontrol et
    const routesResponse = await axios.get(`https://api.mailgun.net/v3/routes`, {
      auth: {
        username: 'api',
        password: apiKey
      }
    });

    // gozdedijital.xyz için route bul
    const gozdeRoute = routesResponse.data.items.find(route => 
      route.expression && route.expression.includes('gozdedijital.xyz')
    );

    if (gozdeRoute) {
      console.log('Found existing route:', gozdeRoute.id);
      console.log('Current actions:', gozdeRoute.actions);
      
      // Route'u güncelle
      const updateData = {
        priority: 0,
        description: 'General route for all @gozdedijital.xyz addresses',
        expression: 'match_recipient(".*@gozdedijital.xyz")',
        action: [`forward("${webhookUrl}")`, 'store()']
      };

      const updateResponse = await axios.post(`https://api.mailgun.net/v3/routes/${gozdeRoute.id}`, updateData, {
        auth: {
          username: 'api',
          password: apiKey
        }
      });

      console.log('✅ Route updated successfully!');
      console.log('New actions:', updateResponse.data.route.actions);
    } else {
      console.log('No existing route found, creating new one...');
      
      const routeData = {
        priority: 0,
        description: 'General route for all @gozdedijital.xyz addresses',
        expression: 'match_recipient(".*@gozdedijital.xyz")',
        action: [`forward("${webhookUrl}")`, 'store()']
      };

      const createResponse = await axios.post(`https://api.mailgun.net/v3/routes`, routeData, {
        auth: {
          username: 'api',
          password: apiKey
        }
      });

      console.log('✅ Route created successfully!');
      console.log('Actions:', createResponse.data.route.actions);
    }

  } catch (error) {
    console.error('Error fixing Mailgun route:', error.response?.data || error.message);
  }
}

fixMailgunRoute();
