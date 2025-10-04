require('dotenv').config();
const axios = require('axios');

async function checkMailgunRoutes() {
  try {
    const apiKey = process.env.MAILGUN_API_KEY;
    const webhookUrl = process.env.WEBHOOK_URL || 'https://mail-backend-mu.vercel.app/v1/mail/webhook';
    
    if (!apiKey) {
      console.error('MAILGUN_API_KEY environment variable is not set');
      return;
    }

    console.log('Checking Mailgun routes...');
    console.log('Webhook URL:', webhookUrl);

    // Mevcut route'ları kontrol et
    const routesResponse = await axios.get(`https://api.mailgun.net/v3/routes`, {
      auth: {
        username: 'api',
        password: apiKey
      }
    });

    console.log('\n📋 Existing Routes:');
    console.log('Total routes:', routesResponse.data.items.length);

    routesResponse.data.items.forEach((route, index) => {
      console.log(`\n${index + 1}. Route ID: ${route.id}`);
      console.log(`   Description: ${route.description}`);
      console.log(`   Expression: ${route.expression}`);
      console.log(`   Actions: ${route.actions.join(', ')}`);
      console.log(`   Priority: ${route.priority}`);
      console.log(`   Created: ${route.created_at}`);
    });

    // gozdedijital.xyz için route var mı kontrol et
    const gozdeRoute = routesResponse.data.items.find(route => 
      route.expression && route.expression.includes('gozdedijital.xyz')
    );

    if (gozdeRoute) {
      console.log('\n✅ Found route for gozdedijital.xyz:');
      console.log('   ID:', gozdeRoute.id);
      console.log('   Expression:', gozdeRoute.expression);
      console.log('   Actions:', gozdeRoute.actions);
    } else {
      console.log('\n❌ No route found for gozdedijital.xyz');
      console.log('Creating route...');
      
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

      console.log('✅ Route created successfully:', createResponse.data);
    }

  } catch (error) {
    console.error('Error checking Mailgun routes:', error.response?.data || error.message);
  }
}

checkMailgunRoutes();
