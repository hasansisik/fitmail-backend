const formData = require('form-data');
const Mailgun = require('mailgun.js');
const axios = require('axios');

class MailgunService {
  constructor() {
    // Environment variables kontrolü
    if (!process.env.MAILGUN_API_KEY) {
      console.warn('MAILGUN_API_KEY environment variable is not set');
      this.mg = null;
      this.domain = null;
      return;
    }

    try {
      this.mailgun = new Mailgun(formData);
      this.mg = this.mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY,
        url: process.env.MAILGUN_DOMAIN_URL || 'https://api.mailgun.net'
      });
      this.domain = process.env.MAILGUN_DOMAIN || 'fitmail.com';
      this.fromEmail = process.env.EMAIL_FROM || 'noreply@fitmail.com';
      this.fromName = process.env.EMAIL_FROM_NAME || 'Fitmail';
      
      console.log('Mailgun client initialized successfully');
      console.log('Domain:', this.domain);
      console.log('API Key exists:', !!process.env.MAILGUN_API_KEY);
    } catch (error) {
      console.error('Failed to initialize Mailgun client:', error);
      this.mg = null;
      this.domain = null;
    }
  }

  // Mailgun'da route oluştur - gelen mailleri webhook'a yönlendir
  async createMailRoute(email) {
    try {
      if (!this.mg || !this.domain || !process.env.MAILGUN_API_KEY) {
        return {
          success: false,
          error: 'Mailgun is not properly configured. Please check your environment variables.'
        };
      }

      // Webhook URL'ini belirle - önce WEBHOOK_URL, sonra VERCEL_URL veya production URL
      let webhookUrl = process.env.WEBHOOK_URL;
      if (!webhookUrl && process.env.VERCEL_URL) {
        // Vercel otomatik olarak VERCEL_URL environment variable'ını set eder
        webhookUrl = `https://${process.env.VERCEL_URL}/v1/mail/webhook`;
      }
      if (!webhookUrl && process.env.BACKEND_URL) {
        webhookUrl = `${process.env.BACKEND_URL}/v1/mail/webhook`;
      }
      // Production fallback - hardcode etmek yerine environment variable kullan
      if (!webhookUrl) {
        // Production URL'ini environment variable'dan al, yoksa default kullan
        const prodUrl = process.env.PRODUCTION_URL || 'api.fitmail.com';
        webhookUrl = `https://${prodUrl}/v1/mail/webhook`;
      }
      
      console.log('Creating Mailgun route for:', email);
      console.log('Webhook URL:', webhookUrl);

      // Mevcut route'ları kontrol et
      try {
        const routesResponse = await axios.get(`https://api.mailgun.net/v3/routes`, {
          auth: {
            username: 'api',
            password: process.env.MAILGUN_API_KEY
          }
        });

        // Zaten var olan bir route varsa, onu kullan
        const existingRoute = routesResponse.data.items.find(route => 
          route.expression && route.expression.includes('fitmail.com')
        );

        if (existingRoute) {
          console.log('Existing Mailgun route found:', existingRoute.id);
          console.log('Route actions:', existingRoute.actions);
          
          // Route'un webhook URL'ini kontrol et
          const hasWebhook = existingRoute.actions.some(action => 
            action.includes('forward') && action.includes(webhookUrl)
          );

          if (hasWebhook) {
            console.log('Route already configured with correct webhook URL');
            return {
              success: true,
              email: email,
              routeId: existingRoute.id,
              route: existingRoute,
              message: 'Route already exists with correct webhook configuration'
            };
          } else {
            console.log('Route exists but webhook URL is outdated, deleting and recreating...');
            // Eski route'u sil
            try {
              await axios.delete(`https://api.mailgun.net/v3/routes/${existingRoute.id}`, {
                auth: {
                  username: 'api',
                  password: process.env.MAILGUN_API_KEY
                }
              });
              console.log('Old route deleted, creating new one...');
            } catch (deleteError) {
              console.warn('Could not delete old route:', deleteError.message);
            }
          }
        }
      } catch (routeCheckError) {
        console.warn('Could not check existing routes:', routeCheckError.message);
      }

      // Yeni route oluştur
      const routeFormData = new URLSearchParams();
      routeFormData.append('priority', '0');
      routeFormData.append('description', `Route for all @${this.domain} addresses`);
      routeFormData.append('expression', `match_recipient(".*@${this.domain}")`);
      // Action sırası önemli: önce store() sonra forward()
      // store() maili Mailgun'un storage'ında saklar
      // forward() maili webhook'a gönderir
      routeFormData.append('action', 'store()');
      routeFormData.append('action', `forward("${webhookUrl}")`);

      console.log('Creating new Mailgun route...');
      const createResponse = await axios.post(`https://api.mailgun.net/v3/routes`, routeFormData, {
        auth: {
          username: 'api',
          password: process.env.MAILGUN_API_KEY
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log('✅ Mailgun route created successfully!');
      console.log('Route ID:', createResponse.data.route.id);
      console.log('Route actions:', createResponse.data.route.actions);
      
      return {
        success: true,
        email: email,
        routeId: createResponse.data.route.id,
        route: createResponse.data.route,
        message: 'Route created successfully'
      };
    } catch (error) {
      console.error('Mailgun create route error:', error);
      console.error('Error details:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
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

      // Kendi domain'imize mail gönderirken, mailin Mailgun'un storage'ında saklanması ve webhook'a gitmesi gerekiyor
      // Route'da store() ve forward() action'ları var, bu yüzden route'un çalışmasına izin veriyoruz
      const messageData = {
        from: `${this.fromName} <${this.fromEmail}>`,
        to: email,
        // o:skip-route kaldırıldı - kendi domain'imize mail gönderirken route'un store() action'ını kullanması gerekiyor
        // o:require-tls ve o:tracking parametreleri eklenmedi çünkü kendi domain'imize mail gönderirken bunlar gerekli değil
        subject: 'Fitmail\'e Hoş Geldiniz! 🎉',
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
                <p>Fitmail ailesine katıldığınız için çok mutluyuz! 🚀</p>
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
                <p>&copy; 2025 Fitmail. Tüm hakları saklıdır.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Merhaba ${name}!\n\nFitmail ailesine katıldığınız için çok mutluyuz!\n\nMail adresiniz: ${email}\n\nArtık güvenli ve hızlı mail sisteminizi kullanmaya başlayabilirsiniz.`
      };

      const response = await this.mg.messages.create(this.domain, messageData);
      
      console.log('Mailgun welcome email response:', JSON.stringify(response, null, 2));
      console.log('Mailgun welcome email message ID:', response.id);
      console.log('Mailgun welcome email message:', response.message);
      
      return {
        success: true,
        messageId: response.id,
        message: response.message,
        response: response
      };
    } catch (error) {
      console.error('Mailgun send welcome email error:', error);
      console.error('Mailgun send welcome email error details:', JSON.stringify(error, null, 2));
      return {
        success: false,
        error: error.message,
        errorDetails: error
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

      const { from, to, subject, text, html, attachments = [], inReplyTo, references } = mailData;

      const messageData = {
        from: from,
        to: to,
        subject: subject,
        text: text,
        html: html,
        'h:Reply-To': from, // Reply-To header'ı gönderen adresine ayarla
        'h:Return-Path': from, // Return-Path header'ı da ekle
        // DKIM ve DMARC için önemli header'lar
        'h:Message-ID': `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${this.domain}>`,
        'h:Date': new Date().toUTCString(),
        // List-Unsubscribe ve List-Id header'ları kaldırıldı - normal maillerin promotions kategorisine düşmemesi için
        // SPF, DKIM, DMARC için gerekli header'lar
        'h:X-Mailer': 'Fitmail Mail System',
        'h:X-Priority': '3',
        'h:X-MSMail-Priority': 'Normal',
        'h:Importance': 'Normal',
        // DMARC policy header'ı
        'h:Authentication-Results': `${this.domain}; dkim=pass; spf=pass; dmarc=pass`,
        // Content-Type ve charset
        'h:Content-Type': 'text/html; charset=UTF-8',
        'h:Content-Transfer-Encoding': '8bit'
      };

      // Threading headers if provided
      if (inReplyTo) {
        messageData['h:In-Reply-To'] = inReplyTo;
      }
      if (references && (Array.isArray(references) ? references.length : true)) {
        messageData['h:References'] = Array.isArray(references) ? references.join(' ') : references;
      }

      // Ekler varsa ekle
      if (attachments && attachments.length > 0) {
        messageData.attachment = attachments.map(attachment => ({
          filename: attachment.filename,
          data: attachment.data
        }));
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

  // Mailbox oluştur (basitleştirilmiş)
  async createMailbox(email) {
    try {
      if (!this.mg || !this.domain) {
        return {
          success: false,
          error: 'Mailgun is not properly configured. Please check your environment variables.'
        };
      }

      // Mailbox oluşturma işlemi kaldırıldı
      // Mailgun'da manuel olarak mailbox oluşturulması gerekiyor
      console.log('Mailbox creation skipped - please create mailbox manually in Mailgun dashboard');
      
      return {
        success: true,
        email: email,
        message: 'Mailbox creation skipped - please create manually in Mailgun dashboard'
      };
    } catch (error) {
      console.error('Mailgun create mailbox error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Mevcut mailbox'ları listele (basitleştirilmiş)
  async listMailboxes() {
    try {
      if (!this.mg || !this.domain) {
        return {
          success: false,
          error: 'Mailgun is not properly configured. Please check your environment variables.'
        };
      }

      // Mailbox listeleme işlemi kaldırıldı
      console.log('Mailbox listing skipped - please check Mailgun dashboard');
      
      return {
        success: true,
        mailboxes: [],
        total: 0,
        message: 'Mailbox listing skipped - please check Mailgun dashboard'
      };
    } catch (error) {
      console.error('Mailgun list mailboxes error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // DKIM ayarlarını kontrol et
  async checkDKIMStatus() {
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
        dkim: {
          enabled: response.dkim_selector ? true : false,
          selector: response.dkim_selector,
          publicKey: response.dkim_public_key,
          state: response.dkim_state
        },
        spf: {
          record: response.spf_record,
          state: response.spf_state
        },
        dmarc: {
          record: response.dmarc_record,
          state: response.dmarc_state
        },
        response: response
      };
    } catch (error) {
      console.error('Mailgun DKIM check error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // DMARC kaydını kontrol et
  async checkDMARCRecord() {
    try {
      const dns = require('dns').promises;
      
      // DMARC TXT kaydını kontrol et
      const dmarcRecords = await dns.resolveTxt(`_dmarc.${this.domain}`);
      
      let dmarcPolicy = null;
      let dmarcValid = false;
      
      for (const record of dmarcRecords) {
        const recordText = record.join('');
        if (recordText.startsWith('v=DMARC1')) {
          dmarcPolicy = recordText;
          dmarcValid = true;
          break;
        }
      }

      return {
        success: true,
        domain: this.domain,
        dmarc: {
          valid: dmarcValid,
          record: dmarcPolicy,
          records: dmarcRecords
        }
      };
    } catch (error) {
      console.error('DMARC record check error:', error);
      return {
        success: false,
        error: error.message,
        domain: this.domain,
        dmarc: {
          valid: false,
          record: null
        }
      };
    }
  }

  // SPF kaydını kontrol et
  async checkSPFRecord() {
    try {
      const dns = require('dns').promises;
      
      // SPF TXT kaydını kontrol et
      const txtRecords = await dns.resolveTxt(this.domain);
      
      let spfRecord = null;
      let spfValid = false;
      
      for (const record of txtRecords) {
        const recordText = record.join('');
        if (recordText.startsWith('v=spf1')) {
          spfRecord = recordText;
          spfValid = true;
          break;
        }
      }

      return {
        success: true,
        domain: this.domain,
        spf: {
          valid: spfValid,
          record: spfRecord,
          records: txtRecords
        }
      };
    } catch (error) {
      console.error('SPF record check error:', error);
      return {
        success: false,
        error: error.message,
        domain: this.domain,
        spf: {
          valid: false,
          record: null
        }
      };
    }
  }

  // Mail authentication durumunu kontrol et
  async checkMailAuthentication() {
    try {
      const [dkimStatus, dmarcStatus, spfStatus] = await Promise.all([
        this.checkDKIMStatus(),
        this.checkDMARCRecord(),
        this.checkSPFRecord()
      ]);

      return {
        success: true,
        domain: this.domain,
        dkim: dkimStatus.success ? dkimStatus.dkim : { enabled: false, state: 'unknown' },
        dmarc: dmarcStatus.success ? dmarcStatus.dmarc : { valid: false, record: null },
        spf: spfStatus.success ? spfStatus.spf : { valid: false, record: null },
        recommendations: this.getAuthenticationRecommendations(dkimStatus, dmarcStatus, spfStatus)
      };
    } catch (error) {
      console.error('Mail authentication check error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Authentication önerileri
  getAuthenticationRecommendations(dkimStatus, dmarcStatus, spfStatus) {
    const recommendations = [];

    if (!dkimStatus.success || !dkimStatus.dkim?.enabled) {
      recommendations.push({
        type: 'dkim',
        priority: 'high',
        message: 'DKIM ayarları eksik. Mailgun dashboard\'dan DKIM\'i aktifleştirin.',
        action: 'Mailgun dashboard > Domains > fitmail.com > DKIM > Enable'
      });
    }

    if (!spfStatus.success || !spfStatus.spf?.valid) {
      recommendations.push({
        type: 'spf',
        priority: 'high',
        message: 'SPF kaydı eksik veya hatalı. DNS\'e SPF kaydı ekleyin.',
        action: `DNS TXT kaydı ekleyin: v=spf1 include:mailgun.org ~all`
      });
    }

    if (!dmarcStatus.success || !dmarcStatus.dmarc?.valid) {
      recommendations.push({
        type: 'dmarc',
        priority: 'medium',
        message: 'DMARC kaydı eksik. Spam koruması için DMARC ekleyin.',
        action: `DNS TXT kaydı ekleyin: v=DMARC1; p=quarantine; rua=mailto:dmarc@${this.domain}`
      });
    }

    return recommendations;
  }
}

module.exports = new MailgunService();
