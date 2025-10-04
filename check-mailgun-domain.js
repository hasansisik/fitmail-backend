require('dotenv').config();
const mailgunService = require('./services/mailgun.service');

async function checkMailgunDomain() {
  try {
    console.log('Checking Mailgun domain configuration...');
    
    // Domain durumunu kontrol et
    const domainStatus = await mailgunService.getDomainStatus();
    console.log('\nDomain Status:', JSON.stringify(domainStatus, null, 2));
    
    if (domainStatus.success) {
      console.log('\n✅ Domain is active and configured');
      console.log('Domain:', domainStatus.domain);
      console.log('State:', domainStatus.state);
      console.log('Type:', domainStatus.type);
      
      // DNS kayıtlarını kontrol et
      if (domainStatus.response && domainStatus.response.receiving_dns_records) {
        console.log('\n📧 Receiving DNS Records:');
        domainStatus.response.receiving_dns_records.forEach((record, index) => {
          console.log(`${index + 1}. ${record.record_type}: ${record.name} -> ${record.value}`);
          console.log(`   Priority: ${record.priority || 'N/A'}`);
          console.log(`   Valid: ${record.valid}`);
        });
      }
      
      if (domainStatus.response && domainStatus.response.sending_dns_records) {
        console.log('\n📤 Sending DNS Records:');
        domainStatus.response.sending_dns_records.forEach((record, index) => {
          console.log(`${index + 1}. ${record.record_type}: ${record.name} -> ${record.value}`);
          console.log(`   Valid: ${record.valid}`);
        });
      }
    } else {
      console.log('\n❌ Domain configuration failed:', domainStatus.error);
    }
    
  } catch (error) {
    console.error('Error checking Mailgun domain:', error);
  }
}

checkMailgunDomain();
