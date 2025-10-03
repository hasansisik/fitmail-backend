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
    this.domain = process.env.MAILGUN_DOMAIN || 'gozdedijital.xyz';
    this.fromEmail = process.env.EMAIL_FROM || 'noreply@gozdedijital.xyz';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Gözde Dijital';
  }

  // Mailgun'da yeni mail adresi oluştur (route ekle)
  async createMailRoute(email) {
    try {
      if (!this.mg || !this.domain) {
        return {
          success: false,
          error: 'Mailgun is not properly configured. Please check your environment variables.'
        };
      }

      // Email adresinden username al
      const username = email.split('@')[0];
      
      // Route oluştur - gelen mailleri MongoDB'ye kaydetmek için
      const routeData = {
        priority: 0,
        description: `Route for ${email}`,
        expression: `match_recipient("${email}")`,
        action: [`forward("http://localhost:5003/v1/mail/webhook")`, 'store()']
      };

      const response = await this.mg.routes.create(routeData);
      
      return {
        success: true,
        route: response,
        email: email
      };
    } catch (error) {
      console.error('Mailgun create route error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Hoşgeldin maili gönder
  async sendWelcomeEmail(email, name) {
    try {
      if (!this.mg || !this.domain) {
        return {
          success: false,
          error: 'Mailgun is not properly configured.'
        };
      }

      const messageData = {
        from: `${this.fromName} <${this.fromEmail}>`,
        to: email,
        subject: 'Gözde Dijital\'e Hoş Geldiniz! 🎉',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
              .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎉 Hoş Geldiniz!</h1>
              </div>
              <div class="content">
                <h2>Merhaba ${name}!</h2>
                <p>Gözde Dijital ailesine katıldığınız için çok mutluyuz! 🚀</p>
                <p>Mail adresiniz: <strong>${email}</strong></p>
                <p>Artık güvenli ve hızlı mail sisteminizi kullanmaya başlayabilirsiniz.</p>
                <div style="text-align: center;">
                  <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/mail" class="button">Mail Kutunuza Git</a>
                </div>
                <h3>Özellikler:</h3>
                <ul>
                  <li>✉️ Sınırsız mail gönderme ve alma</li>
                  <li>🔒 Güvenli ve şifreli iletişim</li>
                  <li>📱 Mobil uyumlu arayüz</li>
                  <li>🚀 Hızlı ve güvenilir altyapı</li>
                </ul>
              </div>
              <div class="footer">
                <p>Bu mail ${this.fromEmail} adresinden gönderilmiştir.</p>
                <p>&copy; 2025 Gözde Dijital. Tüm hakları saklıdır.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Merhaba ${name}!\n\nGözde Dijital ailesine katıldığınız için çok mutluyuz!\n\nMail adresiniz: ${email}\n\nArtık güvenli ve hızlı mail sisteminizi kullanmaya başlayabilirsiniz.`
      };

      const response = await this.mg.messages.create(this.domain, messageData);
      
      return {
        success: true,
        messageId: response.id,
        response: response
      };
    } catch (error) {
      console.error('Mailgun send welcome email error:', error);
      return {
        success: false,
        error: error.message
      };
    }
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
