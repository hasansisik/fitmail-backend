const Mail = require("../models/Mail");
const { User } = require("../models/User");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const mailgunService = require("../services/mailgun.service");
const mongoose = require("mongoose");

// Mail gönderme
const sendMail = async (req, res, next) => {
  try {
    const { to, subject, content, htmlContent, cc, bcc, labels } = req.body;
    const userId = req.user.userId;
    const files = req.files || [];

    console.log("sendMail request body:", req.body);
    console.log("sendMail files:", files);
    console.log("sendMail userId:", userId);

    if (!to || !subject || !content) {
      throw new CustomError.BadRequestError("Alıcı, konu ve içerik gereklidir");
    }

    // Kullanıcıyı bul
    const user = await User.findById(userId);
    if (!user) {
      throw new CustomError.NotFoundError("Kullanıcı bulunamadı");
    }

    // Mail adresini kontrol et
    if (!user.mailAddress) {
      throw new CustomError.BadRequestError("Mail adresiniz tanımlanmamış");
    }

    // Parse JSON strings
    const recipients = Array.isArray(to) ? to : JSON.parse(to);
    const ccRecipients = cc ? (Array.isArray(cc) ? cc : JSON.parse(cc)) : [];
    const bccRecipients = bcc ? (Array.isArray(bcc) ? bcc : JSON.parse(bcc)) : [];

    // Prepare attachments
    const attachmentNames = req.body.attachmentNames ? JSON.parse(req.body.attachmentNames) : [];
    const attachmentTypes = req.body.attachmentTypes ? JSON.parse(req.body.attachmentTypes) : [];
    const attachmentUrls = req.body.attachmentUrls ? JSON.parse(req.body.attachmentUrls) : [];
    
    console.log("Attachment names:", attachmentNames);
    console.log("Attachment types:", attachmentTypes);
    console.log("Attachment URLs:", attachmentUrls);
    
    const attachments = files.map((file, index) => ({
      filename: attachmentNames[index] || file.originalname,
      data: file.buffer,
      contentType: attachmentTypes[index] || file.mimetype,
      size: file.size,
      url: attachmentUrls[index] || null // Cloudinary URL'sini ekle
    }));
    
    console.log("Final attachments:", attachments.map(att => ({ filename: att.filename, url: att.url })));

    // Mail objesi oluştur
    const mailData = {
      from: {
        email: user.mailAddress,
        name: `${user.name} ${user.surname}`
      },
      to: recipients.map(email => ({ email, name: email.split('@')[0] })),
      cc: ccRecipients.map(email => ({ email, name: email.split('@')[0] })),
      bcc: bccRecipients.map(email => ({ email, name: email.split('@')[0] })),
      subject,
      content,
      htmlContent: htmlContent || content,
      folder: 'sent',
      status: 'draft',
      labels: labels || [],
      attachments: attachments || [],
      user: userId
    };

    // Mail'i veritabanına kaydet
    const mail = new Mail(mailData);
    await mail.save();

    // Mailgun ile gönder
    const mailgunData = {
      from: `${mailData.from.name} <${mailData.from.email}>`,
      to: recipients.join(', '),
      subject,
      text: content,
      html: htmlContent || content,
      attachments: attachments || []
    };

    if (ccRecipients.length > 0) {
      mailgunData.cc = ccRecipients.join(', ');
    }
    if (bccRecipients.length > 0) {
      mailgunData.bcc = bccRecipients.join(', ');
    }

    console.log("Mailgun data:", mailgunData);
    const mailgunResult = await mailgunService.sendMail(mailgunData);
    console.log("Mailgun result:", mailgunResult);

    if (mailgunResult.success) {
      // Mail durumunu güncelle
      mail.status = 'sent';
      mail.messageId = mailgunResult.messageId;
      mail.mailgunId = mailgunResult.messageId;
      mail.mailgunResponse = mailgunResult.response;
      await mail.save();

      // Kullanıcının mail listesine ekle
      user.mails.push(mail._id);
      await user.save();

      console.log("Mail saved successfully:", mail._id);

      res.status(StatusCodes.OK).json({
        success: true,
        message: "Mail başarıyla gönderildi",
        mail: {
          _id: mail._id,
          subject: mail.subject,
          to: mail.to,
          status: mail.status,
          sentAt: mail.sentAt
        }
      });
    } else {
      // Gönderim başarısız
      mail.status = 'failed';
      await mail.save();

      // Mailgun yapılandırma hatası ise özel mesaj
      if (mailgunResult.error.includes('not properly configured')) {
        throw new CustomError.BadRequestError('Mail servisi yapılandırılmamış. Lütfen yönetici ile iletişime geçin.');
      }

      throw new CustomError.BadRequestError(`Mail gönderilemedi: ${mailgunResult.error}`);
    }
  } catch (error) {
    next(error);
  }
};

// Gelen kutularını getir
const getInbox = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20, folder = 'inbox', search, label, isRead } = req.query;

    const filter = { user: userId, folder };
    
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { 'from.name': { $regex: search, $options: 'i' } },
        { 'from.email': { $regex: search, $options: 'i' } }
      ];
    }
    
    if (label) {
      filter.labels = { $in: [label] };
    }
    
    if (isRead !== undefined) {
      filter.isRead = isRead === 'true';
    }

    const skip = (page - 1) * limit;
    
    const mails = await Mail.find(filter)
      .populate('user', 'name surname mailAddress')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Mail.countDocuments(filter);

    res.status(StatusCodes.OK).json({
      success: true,
      mails,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    next(error);
  }
};


// Mail'i okundu/okunmadı olarak işaretle
const toggleReadStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    if (mail.isRead) {
      await mail.markAsUnread();
    } else {
      await mail.markAsRead();
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Mail ${mail.isRead ? 'okunmadı' : 'okundu'} olarak işaretlendi`,
      isRead: mail.isRead
    });
  } catch (error) {
    next(error);
  }
};

// Mail'i klasöre taşı
const moveToFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { folder } = req.body;
    const userId = req.user.userId;

    const validFolders = ['inbox', 'sent', 'drafts', 'spam', 'trash', 'archive'];
    if (!validFolders.includes(folder)) {
      throw new CustomError.BadRequestError("Geçersiz klasör");
    }

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    await mail.moveToFolder(folder);

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Mail ${folder} klasörüne taşındı`,
      folder: mail.folder
    });
  } catch (error) {
    next(error);
  }
};

// Mail'i sil
const deleteMail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    // Gerçekten sil veya çöp kutusuna taşı
    if (mail.folder === 'trash') {
      await Mail.findByIdAndDelete(id);
      res.json({
        success: true,
        message: "Mail kalıcı olarak silindi"
      });
    } else {
      await mail.moveToFolder('trash');
      res.json({
        success: true,
        message: "Mail çöp kutusuna taşındı"
      });
    }
  } catch (error) {
    next(error);
  }
};

// Mail'e etiket ekle/çıkar
const manageLabels = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, label } = req.body; // action: 'add' or 'remove'
    const userId = req.user.userId;

    const validLabels = ['work', 'personal', 'important', 'meeting', 'shopping', 'social', 'updates', 'forums', 'promotions'];
    if (!validLabels.includes(label)) {
      throw new CustomError.BadRequestError("Geçersiz etiket");
    }

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    if (action === 'add') {
      await mail.addLabel(label);
    } else if (action === 'remove') {
      await mail.removeLabel(label);
    } else {
      throw new CustomError.BadRequestError("Geçersiz işlem");
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Etiket ${action === 'add' ? 'eklendi' : 'çıkarıldı'}`,
      labels: mail.labels
    });
  } catch (error) {
    next(error);
  }
};

// Mail'i kategoriye taşı
const moveToCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category } = req.body;
    const userId = req.user.userId;

    const validCategories = ['social', 'updates', 'forums', 'shopping', 'promotions'];
    if (!validCategories.includes(category)) {
      throw new CustomError.BadRequestError("Geçersiz kategori");
    }

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    // Kategoriyi ekle
    await mail.addCategory(category);

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Mail ${category} kategorisine taşındı`,
      categories: mail.categories,
      labels: mail.labels
    });
  } catch (error) {
    next(error);
  }
};

// Mail'den kategoriyi kaldır
const removeFromCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category } = req.body;
    const userId = req.user.userId;

    const validCategories = ['social', 'updates', 'forums', 'shopping', 'promotions'];
    if (!validCategories.includes(category)) {
      throw new CustomError.BadRequestError("Geçersiz kategori");
    }

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    // Kategoriyi kaldır
    await mail.removeCategory(category);

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Mail ${category} kategorisinden çıkarıldı`,
      categories: mail.categories,
      labels: mail.labels
    });
  } catch (error) {
    next(error);
  }
};

// Kategoriye göre mailleri getir
const getMailsByCategory = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { category, page = 1, limit = 20, search, isRead } = req.query;

    const validCategories = ['social', 'updates', 'forums', 'shopping', 'promotions'];
    if (!validCategories.includes(category)) {
      throw new CustomError.BadRequestError("Geçersiz kategori");
    }

    // Önce mevcut maillerde categories field'ı yoksa ekle
    await Mail.updateMany(
      { 
        user: new mongoose.Types.ObjectId(userId),
        categories: { $exists: false }
      },
      { $set: { categories: [] } }
    );

    const filter = { 
      user: userId, 
      categories: { $in: [category] }
    };
    
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { 'from.name': { $regex: search, $options: 'i' } },
        { 'from.email': { $regex: search, $options: 'i' } }
      ];
    }
    
    if (isRead !== undefined) {
      filter.isRead = isRead === 'true';
    }

    const skip = (page - 1) * limit;
    
    const mails = await Mail.find(filter)
      .populate('user', 'name surname mailAddress')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Mail.countDocuments(filter);

    res.status(StatusCodes.OK).json({
      success: true,
      mails,
      category,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Label kategorisine göre mailleri getir
const getMailsByLabelCategory = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { category, page = 1, limit = 20, search, isRead } = req.query;

    const validCategories = ['social', 'updates', 'forums', 'shopping', 'promotions'];
    if (!validCategories.includes(category)) {
      throw new CustomError.BadRequestError("Geçersiz kategori");
    }

    // Önce mevcut maillerde categories field'ı yoksa ekle
    await Mail.updateMany(
      { 
        user: new mongoose.Types.ObjectId(userId),
        categories: { $exists: false }
      },
      { $set: { categories: [] } }
    );

    const filter = { 
      user: userId, 
      categories: { $in: [category] }
    };
    
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { 'from.name': { $regex: search, $options: 'i' } },
        { 'from.email': { $regex: search, $options: 'i' } }
      ];
    }
    
    if (isRead !== undefined) {
      filter.isRead = isRead === 'true';
    }

    const skip = (page - 1) * limit;
    const mails = await Mail.find(filter)
      .sort({ receivedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('user', 'name surname mailAddress');

    const total = await Mail.countDocuments(filter);

    res.status(StatusCodes.OK).json({
      success: true,
      mails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Mail istatistikleri
const getMailStats = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    
    // Önce mevcut maillerde categories field'ı yoksa ekle
    await Mail.updateMany(
      { 
        user: new mongoose.Types.ObjectId(userId),
        categories: { $exists: false }
      },
      { $set: { categories: [] } }
    );

    const stats = await Mail.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unread: { $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] } },
          inbox: { $sum: { $cond: [{ $eq: ['$folder', 'inbox'] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $eq: ['$folder', 'sent'] }, 1, 0] } },
          drafts: { $sum: { $cond: [{ $eq: ['$folder', 'drafts'] }, 1, 0] } },
          spam: { $sum: { $cond: [{ $eq: ['$folder', 'spam'] }, 1, 0] } },
          trash: { $sum: { $cond: [{ $eq: ['$folder', 'trash'] }, 1, 0] } },
          archive: { $sum: { $cond: [{ $eq: ['$folder', 'archive'] }, 1, 0] } },
          // Kategori sayıları - categories field'ı yoksa boş array kabul et
          social: { $sum: { $cond: [{ $in: ['social', { $ifNull: ['$categories', []] }] }, 1, 0] } },
          updates: { $sum: { $cond: [{ $in: ['updates', { $ifNull: ['$categories', []] }] }, 1, 0] } },
          forums: { $sum: { $cond: [{ $in: ['forums', { $ifNull: ['$categories', []] }] }, 1, 0] } },
          shopping: { $sum: { $cond: [{ $in: ['shopping', { $ifNull: ['$categories', []] }] }, 1, 0] } },
          promotions: { $sum: { $cond: [{ $in: ['promotions', { $ifNull: ['$categories', []] }] }, 1, 0] } }
        }
      }
    ]);

    const result = stats[0] || {
      total: 0,
      unread: 0,
      inbox: 0,
      sent: 0,
      drafts: 0,
      spam: 0,
      trash: 0,
      archive: 0,
      social: 0,
      updates: 0,
      forums: 0,
      shopping: 0,
      promotions: 0
    };
    
    
    res.status(StatusCodes.OK).json({
      success: true,
      stats: result
    });
  } catch (error) {
    next(error);
  }
};

// Mail adresini kontrol et
const checkMailAddress = async (req, res, next) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;

    if (!email) {
      throw new CustomError.BadRequestError("Mail adresi gereklidir");
    }

    // Kullanıcının domain'ini al
    const user = await User.findById(userId);
    if (!user) {
      throw new CustomError.NotFoundError("Kullanıcı bulunamadı");
    }

    // Mail adresinin kullanıcının domain'i ile uyumlu olup olmadığını kontrol et
    const domain = process.env.MAIL_DOMAIN || 'gozdedijital.xyz';
    if (!email.endsWith(`@${domain}`)) {
      throw new CustomError.BadRequestError(`Mail adresi @${domain} ile bitmelidir`);
    }

    // Mail adresinin daha önce alınıp alınmadığını kontrol et
    const existingUser = await User.findOne({ mailAddress: email });
    if (existingUser && existingUser._id.toString() !== userId) {
      throw new CustomError.BadRequestError("Bu mail adresi zaten kullanılıyor");
    }

    // Mailgun ile doğrula (opsiyonel)
    const validation = await mailgunService.validateEmail(email);
    
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Mail adresi kullanılabilir",
      isValid: validation.success ? validation.isValid : true,
      details: validation.success ? validation.response : null,
      mailgunAvailable: validation.success
    });
  } catch (error) {
    next(error);
  }
};

// Mail adresini ayarla ve Mailgun route oluştur
const setupMailAddress = async (req, res, next) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;

    if (!email) {
      throw new CustomError.BadRequestError("Mail adresi gereklidir");
    }

    // Kullanıcıyı bul
    const user = await User.findById(userId);
    if (!user) {
      throw new CustomError.NotFoundError("Kullanıcı bulunamadı");
    }

    // Mail adresinin domain'ini kontrol et
    const domain = process.env.MAIL_DOMAIN || 'gozdedijital.xyz';
    if (!email.endsWith(`@${domain}`)) {
      throw new CustomError.BadRequestError(`Mail adresi @${domain} ile bitmelidir`);
    }

    // Mail adresinin daha önce alınıp alınmadığını kontrol et
    const existingUser = await User.findOne({ mailAddress: email });
    if (existingUser && existingUser._id.toString() !== userId) {
      throw new CustomError.BadRequestError("Bu mail adresi zaten kullanılıyor");
    }

    // Mailgun route oluştur
    const routeResult = await mailgunService.createMailRoute(email);
    
    if (!routeResult.success) {
      throw new CustomError.BadRequestError(`Mailgun route oluşturulamadı: ${routeResult.error}`);
    }

    // Kullanıcının mail adresini güncelle
    user.mailAddress = email;
    await user.save();

    console.log(`Mail address setup completed for user ${userId}: ${email}`);

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Mail adresi başarıyla ayarlandı ve Mailgun route oluşturuldu",
      mailAddress: email,
      route: routeResult.route,
      webhookUrl: process.env.WEBHOOK_URL || 'https://mail-backend-mu.vercel.app/v1/mail/webhook'
    });
  } catch (error) {
    next(error);
  }
};

// Mailgun yapılandırmasını test et
const testMailgunConfig = async (req, res, next) => {
  try {
    const domainStatus = await mailgunService.getDomainStatus();
    
    res.status(StatusCodes.OK).json({
      success: true,
      configured: domainStatus.success,
      message: domainStatus.success ? 'Mailgun yapılandırması başarılı' : 'Mailgun yapılandırması eksik',
      details: domainStatus
    });
  } catch (error) {
    next(error);
  }
};

// Mailbox oluştur
const createMailbox = async (req, res, next) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;

    if (!email) {
      throw new CustomError.BadRequestError("Mail adresi gereklidir");
    }

    // Domain kontrolü
    const domain = process.env.MAIL_DOMAIN || 'gozdedijital.xyz';
    if (!email.endsWith(`@${domain}`)) {
      throw new CustomError.BadRequestError(`Mail adresi @${domain} ile bitmelidir`);
    }

    // Mailbox oluştur
    const mailboxResult = await mailgunService.createMailbox(email);
    
    if (!mailboxResult.success) {
      throw new CustomError.BadRequestError(`Mailbox oluşturulamadı: ${mailboxResult.error}`);
    }

    // Kullanıcının mail adresini güncelle
    const user = await User.findById(userId);
    if (user) {
      user.mailAddress = email;
      await user.save();
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Mailbox başarıyla oluşturuldu",
      mailbox: mailboxResult.mailbox,
      email: email,
      password: mailboxResult.password
    });
  } catch (error) {
    next(error);
  }
};

// Mevcut mailbox'ları listele
const listMailboxes = async (req, res, next) => {
  try {
    const mailboxesResult = await mailgunService.listMailboxes();
    
    if (!mailboxesResult.success) {
      throw new CustomError.BadRequestError(`Mailbox'lar listelenemedi: ${mailboxesResult.error}`);
    }

    res.status(StatusCodes.OK).json({
      success: true,
      mailboxes: mailboxesResult.mailboxes,
      total: mailboxesResult.total
    });
  } catch (error) {
    next(error);
  }
};

// Get Mail by ID
const getMailById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    // Okunmamışsa okundu olarak işaretle
    if (!mail.isRead) {
      await mail.markAsRead();
    }

    res.status(StatusCodes.OK).json({
      success: true,
      mail
    });
  } catch (error) {
    next(error);
  }
};

// Webhook test endpoint'i - gelen mail simülasyonu
const testWebhook = async (req, res, next) => {
  try {
    const { recipient, sender, subject, content } = req.body;
    
    if (!recipient || !sender || !subject) {
      throw new CustomError.BadRequestError("Recipient, sender ve subject gereklidir");
    }

    // Test webhook verisi oluştur
    const testWebhookData = {
      recipient: recipient,
      sender: sender,
      subject: subject,
      'body-plain': content || 'Test mail içeriği',
      'body-html': `<p>${content || 'Test mail içeriği'}</p>`,
      timestamp: Math.floor(Date.now() / 1000),
      'Message-Id': `test-${Date.now()}@${process.env.MAILGUN_DOMAIN || 'gozdedijital.xyz'}`,
      'attachment-count': '2',
      'attachment-1': 'test-document.pdf',
      'attachment-1-url': 'https://example.com/test-document.pdf',
      'attachment-1-size': '1024',
      'attachment-1-content-type': 'application/pdf',
      'attachment-2': 'test-image.jpg',
      'attachment-2-url': 'https://example.com/test-image.jpg',
      'attachment-2-size': '2048',
      'attachment-2-content-type': 'image/jpeg'
    };

    // Webhook handler'ını çağır
    const mockReq = { body: testWebhookData };
    const mockRes = {
      status: (code) => ({
        json: (data) => {
          console.log('Test webhook response:', data);
          return data;
        }
      })
    };

    await handleMailgunWebhook(mockReq, mockRes, next);

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Test webhook çalıştırıldı',
      testData: testWebhookData
    });
  } catch (error) {
    next(error);
  }
};

// Mailgun webhook handler - gelen mailleri almak için
const handleMailgunWebhook = async (req, res, next) => {
  try {
    console.log('=== MAILGUN WEBHOOK RECEIVED ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('================================');
    
    const webhookData = req.body;
    
    // Mailgun webhook verisini kontrol et
    if (!webhookData || !webhookData['recipient']) {
      console.log('Invalid webhook data - missing recipient');
      return res.status(StatusCodes.OK).json({ message: 'Webhook received but no recipient' });
    }

    // Mailgun webhook verilerini parse et
    const recipient = webhookData['recipient'];
    const sender = webhookData['sender'] || webhookData['from'] || 'unknown@example.com';
    const subject = webhookData['subject'] || 'No Subject';
    const bodyPlain = webhookData['body-plain'] || webhookData['stripped-text'] || '';
    const bodyHtml = webhookData['body-html'] || webhookData['stripped-html'] || '';
    const timestamp = webhookData['timestamp'] ? parseInt(webhookData['timestamp']) : Date.now() / 1000;
    const messageId = webhookData['Message-Id'] || webhookData['message-id'] || `mg-${Date.now()}`;
    
    // CC ve BCC bilgilerini parse et
    const cc = webhookData['cc'] ? webhookData['cc'].split(',').map(email => ({
      email: email.trim(),
      name: email.trim().split('@')[0]
    })) : [];
    
    const bcc = webhookData['bcc'] ? webhookData['bcc'].split(',').map(email => ({
      email: email.trim(),
      name: email.trim().split('@')[0]
    })) : [];

    // Gönderen adını parse et
    const senderName = webhookData['sender'] && webhookData['sender'].includes('<') 
      ? webhookData['sender'].split('<')[0].trim().replace(/"/g, '')
      : sender.split('@')[0];

    console.log('Processing mail:', { 
      recipient, 
      sender, 
      senderName, 
      subject, 
      messageId,
      timestamp: new Date(timestamp * 1000),
      isReply: subject.toLowerCase().startsWith('re:'),
      isGmail: sender.includes('@gmail.com')
    });

    // Alıcı kullanıcıyı bul - mailAddress alanında ara
    const recipientUser = await User.findOne({ mailAddress: recipient });
    
    if (!recipientUser) {
      console.log('Recipient user not found for mail address:', recipient);
      return res.status(StatusCodes.OK).json({ 
        message: 'User not found but webhook accepted',
        recipient: recipient
      });
    }

    // Attachment'ları parse et
    const attachments = [];
    if (webhookData['attachment-count'] && parseInt(webhookData['attachment-count']) > 0) {
      const attachmentCount = parseInt(webhookData['attachment-count']);
      for (let i = 1; i <= attachmentCount; i++) {
        const attachmentName = webhookData[`attachment-${i}`];
        const attachmentUrl = webhookData[`attachment-${i}-url`];
        const attachmentSize = webhookData[`attachment-${i}-size`];
        const attachmentType = webhookData[`attachment-${i}-content-type`];
        
        if (attachmentName) {
          attachments.push({
            filename: attachmentName,
            originalName: attachmentName,
            mimeType: attachmentType || 'application/octet-stream',
            size: attachmentSize ? parseInt(attachmentSize) : 0,
            url: attachmentUrl || null
          });
        }
      }
    }

    console.log('Parsed attachments:', attachments);

    // Mail objesi oluştur
    const mailData = {
      from: {
        email: sender,
        name: senderName
      },
      to: [{ 
        email: recipient, 
        name: recipientUser.name || recipient.split('@')[0] 
      }],
      cc: cc,
      bcc: bcc,
      subject,
      content: bodyPlain,
      htmlContent: bodyHtml || bodyPlain,
      folder: 'inbox',
      status: 'delivered',
      isRead: false,
      receivedAt: new Date(timestamp * 1000), // Unix timestamp to Date
      messageId: messageId,
      mailgunId: messageId,
      user: recipientUser._id,
      labels: [], // Gelen mailler için boş etiket listesi
      categories: [], // Gelen mailler için boş kategori listesi
      attachments: attachments // Attachment'ları ekle
    };

    // Mail'i veritabanına kaydet
    const mail = new Mail(mailData);
    await mail.save();

    // Kullanıcının mail listesine ekle (eğer mails array'i varsa)
    if (recipientUser.mails) {
      recipientUser.mails.push(mail._id);
      await recipientUser.save();
    }

    console.log('Mail saved successfully:', {
      mailId: mail._id,
      recipient: recipient,
      subject: subject,
      receivedAt: mail.receivedAt
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Mail received and saved',
      mailId: mail._id,
      recipient: recipient
    });
  } catch (error) {
    console.error('Webhook error:', error);
    // Webhook hatalarında hata döndürme, Mailgun tekrar deneyebilir
    res.status(StatusCodes.OK).json({ 
      message: 'Webhook received but processing failed',
      error: error.message 
    });
  }
};

// Mark Mail as Important
const markMailAsImportant = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    mail.isImportant = !mail.isImportant;
    await mail.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Mail ${mail.isImportant ? 'önemli' : 'önemli değil'} olarak işaretlendi`,
      isImportant: mail.isImportant
    });
  } catch (error) {
    next(error);
  }
};

// Mark Mail as Starred
const markMailAsStarred = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    mail.isStarred = !mail.isStarred;
    await mail.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Mail ${mail.isStarred ? 'yıldızlı' : 'yıldızsız'} olarak işaretlendi`,
      isStarred: mail.isStarred
    });
  } catch (error) {
    next(error);
  }
};

// Snooze Mail
const snoozeMail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { snoozeUntil } = req.body;
    const userId = req.user.userId;

    if (!snoozeUntil) {
      throw new CustomError.BadRequestError("Erteleme tarihi gereklidir");
    }

    const mail = await Mail.findOne({ _id: id, user: userId });
    if (!mail) {
      throw new CustomError.NotFoundError("Mail bulunamadı");
    }

    mail.snoozeUntil = new Date(snoozeUntil);
    await mail.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Mail ertelendi",
      snoozeUntil: mail.snoozeUntil
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendMail,
  getInbox,
  getMailById,
  toggleReadStatus,
  moveToFolder,
  deleteMail,
  manageLabels,
  moveToCategory,
  removeFromCategory,
  getMailsByCategory,
  getMailsByLabelCategory,
  getMailStats,
  markMailAsImportant,
  markMailAsStarred,
  snoozeMail,
  checkMailAddress,
  setupMailAddress,
  testMailgunConfig,
  createMailbox,
  listMailboxes,
  testWebhook,
  handleMailgunWebhook
};
