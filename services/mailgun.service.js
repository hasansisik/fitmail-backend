const formData = require('form-data');
const Mailgun = require('mailgun.js');

class MailgunService {
  constructor() {
    // Environment variables kontrolü
    if (!process.env.MAILGUN_API_KEY) {
      console.warn('MAILGUN_API_KEY environment variable is not set');
      this.mg = null;
      this.domain = null;
      return;
    }

    this.mailgun = new Mailgun(formData);
    this.mg = this.mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
      url: process.env.MAILGUN_DOMAIN_URL || 'https://api.mailgun.net'
    });
    this.domain = process.env.MAILGUN_DOMAIN;
  }

  // Mail gönderme
  async sendMail(mailData) {
    try {
      if (!this.mg || !this.domain) {
        return {
          success: false,
          error: 'Mailgun is not properly configured. Please check your environment variables.'
        };
      }

      const { from, to, subject, text, html, attachments = [] } = mailData;

      const messageData = {
        from: from,
        to: to,
        subject: subject,
        text: text,
        html: html,
        'h:Reply-To': from
      };

      // Ekler varsa ekle
      if (attachments && attachments.length > 0) {
        attachments.forEach(attachment => {
          messageData.attachment = messageData.attachment || [];
          messageData.attachment.push({
            filename: attachment.filename,
            data: attachment.data
          });
        });
      }

      const response = await this.mg.messages.create(this.domain, messageData);
      
      return {
        success: true,
        messageId: response.id,
        response: response
      };
    } catch (error) {
      console.error('Mailgun send error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Mail doğrulama
  async validateEmail(email) {
    try {
      if (!this.mg) {
        return {
          success: false,
          error: 'Mailgun is not properly configured. Please check your environment variables.'
        };
      }

      const response = await this.mg.validate.get(email);
      return {
        success: true,
        isValid: response.is_valid,
        isDisposable: response.is_disposable,
        isRole: response.is_role,
        isCatchAll: response.is_catch_all,
        response: response
      };
    } catch (error) {
      console.error('Mailgun validation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Webhook işleme
  async handleWebhook(webhookData) {
    try {
      const { event, message } = webhookData;
      
      // Mail durumunu güncelle
      const mailgunId = message.headers['message-id'];
      
      return {
        success: true,
        event: event,
        messageId: mailgunId
      };
    } catch (error) {
      console.error('Mailgun webhook error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Domain durumu kontrolü
  async getDomainStatus() {
    try {
      if (!this.mg || !this.domain) {
        return {
          success: false,
          error: 'Mailgun is not properly configured. Please check your environment variables.'
        };
      }

      const response = await this.mg.domains.get(this.domain);
      return {
        success: true,
        domain: response.name,
        state: response.state,
        type: response.type,
        response: response
      };
    } catch (error) {
      console.error('Mailgun domain status error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new MailgunService();
