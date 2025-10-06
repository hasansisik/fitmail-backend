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
      status: 'draft', // Draft olarak başla, gönderim başarılı olursa 'sent' olacak
      labels: labels || [],
      attachments: attachments || [],
      user: userId
    };

    // Mail'i veritabanına kaydet
    const mail = new Mail(mailData);
    await mail.save();
    console.log("Mail saved to database with ID:", mail._id);
    console.log("Mail folder:", mail.folder);
    console.log("Mail status:", mail.status);

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
      console.log("Mail status updated to 'sent' for ID:", mail._id);

      // Kullanıcının mail listesine ekle
      user.mails.push(mail._id);
      await user.save();
      console.log("Mail added to user's mail list. User ID:", userId);

      console.log("Mail sent successfully:", mail._id);
      console.log("Final mail folder:", mail.folder);
      console.log("Final mail status:", mail.status);

      res.status(StatusCodes.OK).json({
        success: true,
        message: "Mail başarıyla gönderildi",
        mail: {
          _id: mail._id,
          subject: mail.subject,
          to: mail.to,
          status: mail.status,
          folder: mail.folder,
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
      // Mail'i çöp kutusuna taşı ve silme tarihini ekle
      mail.folder = 'trash';
      mail.deletedAt = new Date(); // Silme tarihini kaydet
      await mail.save();
      
      res.json({
        success: true,
        message: "Mail çöp kutusuna taşındı. 30 gün sonra otomatik olarak silinecek."
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
          // Okunmamış mail sayıları - sadece okunmamış mailleri say
          inbox: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'inbox'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'sent'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          drafts: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'drafts'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          spam: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'spam'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          trash: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'trash'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          archive: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'archive'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          // Kategori okunmamış sayıları - sadece okunmamış mailleri say
          social: { $sum: { $cond: [{ $and: [{ $in: ['social', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          updates: { $sum: { $cond: [{ $and: [{ $in: ['updates', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          forums: { $sum: { $cond: [{ $and: [{ $in: ['forums', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          shopping: { $sum: { $cond: [{ $and: [{ $in: ['shopping', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          promotions: { $sum: { $cond: [{ $and: [{ $in: ['promotions', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } }
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

    // Test webhook verisi oluştur - Gmail formatında
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
      'attachment-2-content-type': 'image/jpeg',
      // Gmail'in gerçek formatı
      'Content-Type-1': 'image/png; name="Adsız tasarım (5).png"',
      'Content-Disposition-1': 'attachment; filename="Adsız tasarım (5).png"',
      'X-Attachment-Id-1': 'f_mgedldsz1',
      'Content-ID-1': '<f_mgedldsz1>',
      'Content-Type-2': 'application/zip; name="917c736a-6b30-4e30-94cf-87c7f4d395df_f.zip"',
      'Content-Disposition-2': 'attachment; filename="917c736a-6b30-4e30-94cf-87c7f4d395df_f.zip"',
      'X-Attachment-Id-2': 'f_mgedldss0',
      'Content-ID-2': '<f_mgedldss0>'
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
    console.log('Files:', req.files ? req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, size: f.size })) : 'No files');
    console.log('Content-Type:', req.headers['content-type']);
    console.log('================================');
    
    let webhookData = req.body;
    
    // Eğer files varsa, bunları webhookData'ya ekle
    if (req.files && req.files.length > 0) {
      console.log('Processing uploaded files...');
      req.files.forEach((file, index) => {
        console.log(`File ${index}:`, {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });
        
        // Mailgun'un attachment formatına uygun olarak ekle
        const attachmentIndex = index + 1;
        webhookData[`attachment-${attachmentIndex}`] = file.originalname;
        webhookData[`attachment-${attachmentIndex}-content-type`] = file.mimetype;
        webhookData[`attachment-${attachmentIndex}-size`] = file.size.toString();
        
        // Gmail attachment URL'sini bul ve ekle
        const attachmentUrl = webhookData[`attachment-${attachmentIndex}-url`] || 
                             webhookData[`${file.fieldname}-url`] ||
                             webhookData[`url-${attachmentIndex}`] ||
                             null;
        
        if (attachmentUrl) {
          webhookData[`attachment-${attachmentIndex}-url`] = attachmentUrl;
          console.log(`Found attachment URL for ${file.originalname}: ${attachmentUrl}`);
        } else {
          // Gmail attachment URL'sini content-id-map'ten çıkarmaya çalış
          const contentIdMap = webhookData['content-id-map'];
          if (contentIdMap) {
            try {
              const idMap = JSON.parse(contentIdMap);
              const contentIds = Object.keys(idMap);
              if (contentIds.length > index) {
                const contentId = contentIds[index];
                // Gmail attachment URL formatı
                const gmailUrl = `https://mail.google.com/mail/u/0?ui=2&ik=7ac7c89a8e&attid=0.${attachmentIndex}&permmsgid=${webhookData['Message-Id']}&th=${webhookData['Message-Id']}&view=att&disp=safe&realattid=${contentId.replace('<', '').replace('>', '')}&zw`;
                webhookData[`attachment-${attachmentIndex}-url`] = gmailUrl;
                console.log(`Generated Gmail URL for ${file.originalname}: ${gmailUrl}`);
              }
            } catch (e) {
              console.log('Could not parse content-id-map:', e.message);
            }
          }
        }
        
        // Eğer fieldname attachment içeriyorsa, o field'ı da ekle
        if (file.fieldname.includes('attachment')) {
          webhookData[file.fieldname] = file.originalname;
        }
      });
      
      // Attachment count'u güncelle
      webhookData['attachment-count'] = req.files.length.toString();
      
      // Multer ile işlenen dosyalar varsa, Gmail attachment detection'ı atla
      webhookData['_multerProcessed'] = true;
    }
    
    // Normal webhook işleme
    processWebhookData(webhookData, res);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(StatusCodes.OK).json({ 
      message: 'Webhook received but processing failed',
      error: error.message 
    });
  }
};

// Webhook data işleme fonksiyonu
const processWebhookData = async (webhookData, res) => {
  try {
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

    // Attachment'ları parse et - Gmail için geliştirilmiş parsing
    const attachments = [];
    console.log('=== ATTACHMENT PARSING START ===');
    console.log('Webhook data keys:', Object.keys(webhookData));
    console.log('Full webhook data:', JSON.stringify(webhookData, null, 2));
    
    // Tüm mail sağlayıcılarından gelen attachment'ları özel olarak logla
    console.log('Mail detected - checking for attachments...');
    Object.keys(webhookData).forEach(key => {
      if (key.toLowerCase().includes('attachment') || 
          key.toLowerCase().includes('file') || 
          key.toLowerCase().includes('document') ||
          key.toLowerCase().includes('image') ||
          key.toLowerCase().includes('photo') ||
          key.toLowerCase().includes('attach') ||
          key.toLowerCase().includes('media') ||
          key.toLowerCase().includes('upload')) {
        console.log(`Attachment key found: ${key} = ${webhookData[key]}`);
      }
    });
    
    // Farklı attachment formatlarını kontrol et
    const attachmentCount = webhookData['attachment-count'] || webhookData['attachment_count'] || webhookData['attachmentCount'] || 0;
    console.log('Attachment count:', attachmentCount);
    
    if (parseInt(attachmentCount) > 0) {
      const count = parseInt(attachmentCount);
      for (let i = 1; i <= count; i++) {
        // Farklı key formatlarını dene
        const attachmentName = webhookData[`attachment-${i}`] || webhookData[`attachment_${i}`] || webhookData[`attachment${i}`];
        const attachmentUrl = webhookData[`attachment-${i}-url`] || webhookData[`attachment_${i}_url`] || webhookData[`attachment${i}_url`];
        const attachmentSize = webhookData[`attachment-${i}-size`] || webhookData[`attachment_${i}_size`] || webhookData[`attachment${i}_size`];
        const attachmentType = webhookData[`attachment-${i}-content-type`] || webhookData[`attachment_${i}_content_type`] || webhookData[`attachment${i}_content_type`];
        
        console.log(`Attachment ${i}:`, {
          name: attachmentName,
          url: attachmentUrl,
          size: attachmentSize,
          type: attachmentType
        });
        
        if (attachmentName && !attachmentName.includes('{') && !attachmentName.includes('}')) {
          // Duplicate kontrolü - aynı filename zaten varsa ekleme
          const existingAttachment = attachments.find(att => att.filename === attachmentName);
          if (!existingAttachment) {
            attachments.push({
              filename: attachmentName,
              originalName: attachmentName,
              mimeType: attachmentType || 'application/octet-stream',
              size: attachmentSize ? parseInt(attachmentSize) : 0,
              url: attachmentUrl || null
            });
            console.log(`Added attachment: ${attachmentName} with URL: ${attachmentUrl || 'null'}`);
          }
        }
      }
    }

    // Gmail'den gelen attachment'ları da kontrol et (sadece multer işlemediyse)
    if (!webhookData['_multerProcessed'] && webhookData['attachments'] && Array.isArray(webhookData['attachments'])) {
      console.log('Gmail attachments array:', webhookData['attachments']);
      webhookData['attachments'].forEach((attachment, index) => {
        if (attachment.filename || attachment.name) {
          attachments.push({
            filename: attachment.filename || attachment.name,
            originalName: attachment.filename || attachment.name,
            mimeType: attachment.contentType || attachment.mimeType || 'application/octet-stream',
            size: attachment.size || 0,
            url: attachment.url || null
          });
        }
      });
    }

    // Gmail'in farklı attachment formatlarını kontrol et (sadece multer işlemediyse)
    if (!webhookData['_multerProcessed']) {
      Object.keys(webhookData).forEach(key => {
        if (key.includes('attachment') && !key.includes('count') && !key.includes('url') && !key.includes('size') && !key.includes('content-type')) {
          console.log(`Found attachment key: ${key} = ${webhookData[key]}`);
          // Eğer bu bir attachment dosya adı ise
        if (webhookData[key] && typeof webhookData[key] === 'string' && webhookData[key].includes('.')) {
          const attachmentName = webhookData[key];
          const attachmentUrl = webhookData[`${key}-url`] || webhookData[`${key}_url`];
          const attachmentSize = webhookData[`${key}-size`] || webhookData[`${key}_size`];
          const attachmentType = webhookData[`${key}-content-type`] || webhookData[`${key}_content_type`];
          
          attachments.push({
            filename: attachmentName,
            originalName: attachmentName,
            mimeType: attachmentType || 'application/octet-stream',
            size: attachmentSize ? parseInt(attachmentSize) : 0,
            url: attachmentUrl || null
          });
        }
      }
    });

    // Gmail'in özel attachment formatlarını kontrol et - Daha kapsamlı (sadece multer işlemediyse)
    if (!webhookData['_multerProcessed']) {
      console.log('=== GMAIL ATTACHMENT DETECTION ===');
      
      // Gmail'in farklı attachment formatlarını kontrol et
      const gmailAttachmentKeys = Object.keys(webhookData).filter(key => 
        key.toLowerCase().includes('attachment') || 
        key.toLowerCase().includes('file') || 
        key.toLowerCase().includes('document') ||
        key.toLowerCase().includes('image') ||
        key.toLowerCase().includes('photo') ||
        key.toLowerCase().includes('attach') ||
        key.toLowerCase().includes('media') ||
        key.toLowerCase().includes('upload') ||
        key.toLowerCase().includes('binary') ||
        key.toLowerCase().includes('content') ||
        key.toLowerCase().includes('part') ||
        key.toLowerCase().includes('disposition') ||
        key.toLowerCase().includes('transfer-encoding') ||
        key.toLowerCase().includes('x-attachment-id') ||
        key.toLowerCase().includes('content-id')
      );
      
      console.log('Gmail attachment keys found:', gmailAttachmentKeys);
    
      // Gmail'in multipart/mixed formatındaki attachment'ları parse et
      // Content-Disposition: attachment; filename="..." formatını kontrol et
      Object.keys(webhookData).forEach(key => {
        const value = webhookData[key];
        if (value && typeof value === 'string') {
          // Content-Disposition header'ını kontrol et
          if (key.toLowerCase().includes('content-disposition') && value.includes('attachment')) {
            console.log(`Found Content-Disposition: ${key} = ${value}`);
            
            // filename="..." kısmını çıkar
            const filenameMatch = value.match(/filename="([^"]+)"/);
            if (filenameMatch) {
              const filename = filenameMatch[1];
              console.log(`Extracted filename from Content-Disposition: ${filename}`);
              
              // MIME type'ı tahmin et
              let mimeType = 'application/octet-stream';
              if (filename.includes('.jpg') || filename.includes('.jpeg')) mimeType = 'image/jpeg';
              else if (filename.includes('.png')) mimeType = 'image/png';
              else if (filename.includes('.gif')) mimeType = 'image/gif';
              else if (filename.includes('.pdf')) mimeType = 'application/pdf';
              else if (filename.includes('.doc')) mimeType = 'application/msword';
              else if (filename.includes('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              else if (filename.includes('.txt')) mimeType = 'text/plain';
              else if (filename.includes('.zip')) mimeType = 'application/zip';
              else if (filename.includes('.rar')) mimeType = 'application/x-rar-compressed';
              else if (filename.includes('.mp4')) mimeType = 'video/mp4';
              else if (filename.includes('.mp3')) mimeType = 'audio/mpeg';
              else if (filename.includes('.ppt')) mimeType = 'application/vnd.ms-powerpoint';
              else if (filename.includes('.pptx')) mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
              else if (filename.includes('.xls')) mimeType = 'application/vnd.ms-excel';
              else if (filename.includes('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
              
              // Eğer bu attachment zaten eklenmemişse ekle
              const existingAttachment = attachments.find(att => att.filename === filename);
              if (!existingAttachment) {
                attachments.push({
                  filename: filename,
                  originalName: filename,
                  mimeType: mimeType,
                  size: 0,
                  url: null
                });
                console.log(`Added Gmail attachment from Content-Disposition: ${filename}`);
              }
            }
          }
          
          // Content-Type header'ını kontrol et (name="..." kısmı)
          if (key.toLowerCase().includes('content-type') && value.includes('name=')) {
            console.log(`Found Content-Type with name: ${key} = ${value}`);
            
            // name="..." kısmını çıkar
            const nameMatch = value.match(/name="([^"]+)"/);
            if (nameMatch) {
              const filename = nameMatch[1];
              console.log(`Extracted filename from Content-Type: ${filename}`);
              
              // MIME type'ı header'dan al
              const mimeType = value.split(';')[0].trim();
              
              // Eğer bu attachment zaten eklenmemişse ekle
              const existingAttachment = attachments.find(att => att.filename === filename);
              if (!existingAttachment) {
                attachments.push({
                  filename: filename,
                  originalName: filename,
                  mimeType: mimeType,
                  size: 0,
                  url: null
                });
                console.log(`Added Gmail attachment from Content-Type: ${filename} (${mimeType})`);
              }
            }
          }
        }
      });
    }
    
      gmailAttachmentKeys.forEach(key => {
        const value = webhookData[key];
        console.log(`Checking Gmail key: ${key} = ${value}`);
        
        if (value && typeof value === 'string') {
          // Dosya uzantısı kontrolü
          const hasFileExtension = /\.(jpg|jpeg|png|gif|pdf|doc|docx|txt|zip|rar|mp4|mp3|avi|mov|wav|mp3|ppt|pptx|xls|xlsx)$/i.test(value);
          const isUrl = value.startsWith('http');
          const isBase64 = value.includes('base64') || value.includes('data:');
          const isGmailAttachment = value.includes('mail.google.com') || value.includes('attachment');
          
          console.log(`Gmail attachment analysis for ${key}:`, {
            hasFileExtension,
            isUrl,
            isBase64,
            isGmailAttachment,
            value: value.substring(0, 100) + (value.length > 100 ? '...' : '')
          });
          
          if (hasFileExtension || isUrl || isGmailAttachment) {
            console.log(`Processing Gmail attachment key: ${key} = ${value}`);
            
            // JSON formatındaki değerleri atla (content-id-map gibi)
            if (value.includes('{') && value.includes('}')) {
              console.log(`Skipping JSON value: ${key} = ${value}`);
              return;
            }
            
            // Dosya adını çıkar
            let filename = value;
            if (value.includes('/')) {
              filename = value.split('/').pop() || value;
            }
            if (value.includes('\\')) {
              filename = value.split('\\').pop() || filename;
            }
            
            // URL'yi bul
            const url = value.startsWith('http') ? value : null;
            
            // MIME type'ı tahmin et
            let mimeType = 'application/octet-stream';
            if (filename.includes('.jpg') || filename.includes('.jpeg')) mimeType = 'image/jpeg';
            else if (filename.includes('.png')) mimeType = 'image/png';
            else if (filename.includes('.gif')) mimeType = 'image/gif';
            else if (filename.includes('.pdf')) mimeType = 'application/pdf';
            else if (filename.includes('.doc')) mimeType = 'application/msword';
            else if (filename.includes('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            else if (filename.includes('.txt')) mimeType = 'text/plain';
            else if (filename.includes('.zip')) mimeType = 'application/zip';
            else if (filename.includes('.rar')) mimeType = 'application/x-rar-compressed';
            else if (filename.includes('.mp4')) mimeType = 'video/mp4';
            else if (filename.includes('.mp3')) mimeType = 'audio/mpeg';
            else if (filename.includes('.ppt')) mimeType = 'application/vnd.ms-powerpoint';
            else if (filename.includes('.pptx')) mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            else if (filename.includes('.xls')) mimeType = 'application/vnd.ms-excel';
            else if (filename.includes('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            
            // Eğer bu attachment zaten eklenmemişse ekle
            const existingAttachment = attachments.find(att => att.filename === filename);
            if (!existingAttachment) {
              attachments.push({
                filename: filename,
                originalName: filename,
                mimeType: mimeType,
                size: 0, // Gmail'den gelen attachment'larda size bilgisi olmayabilir
                url: url
              });
              console.log(`Added Gmail attachment: ${filename}`);
            }
          }
        }
      });
    }
    
    // Tüm mail sağlayıcılarının özel attachment formatlarını kontrol et
    // Gmail, Outlook, Yahoo vb. bazen attachment'ları farklı key'lerle gönderebilir
    const attachmentKeys = Object.keys(webhookData).filter(key => 
      key.toLowerCase().includes('attachment') || 
      key.toLowerCase().includes('file') || 
      key.toLowerCase().includes('document') ||
      key.toLowerCase().includes('image') ||
      key.toLowerCase().includes('photo') ||
      key.toLowerCase().includes('attach') ||
      key.toLowerCase().includes('media')
    );
    
    console.log('All attachment keys found:', attachmentKeys);
    
    attachmentKeys.forEach(key => {
      const value = webhookData[key];
      if (value && typeof value === 'string' && (value.includes('.') || value.includes('http'))) {
        console.log(`Processing attachment key: ${key} = ${value}`);
        
        // Dosya adını çıkar
        let filename = value;
        if (value.includes('/')) {
          filename = value.split('/').pop() || value;
        }
        
        // URL'yi bul
        const url = value.startsWith('http') ? value : null;
        
        // MIME type'ı tahmin et
        let mimeType = 'application/octet-stream';
        if (filename.includes('.jpg') || filename.includes('.jpeg')) mimeType = 'image/jpeg';
        else if (filename.includes('.png')) mimeType = 'image/png';
        else if (filename.includes('.gif')) mimeType = 'image/gif';
        else if (filename.includes('.pdf')) mimeType = 'application/pdf';
        else if (filename.includes('.doc')) mimeType = 'application/msword';
        else if (filename.includes('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (filename.includes('.txt')) mimeType = 'text/plain';
        else if (filename.includes('.zip')) mimeType = 'application/zip';
        else if (filename.includes('.rar')) mimeType = 'application/x-rar-compressed';
        else if (filename.includes('.mp4')) mimeType = 'video/mp4';
        else if (filename.includes('.mp3')) mimeType = 'audio/mpeg';
        
        // Eğer bu attachment zaten eklenmemişse ekle
        const existingAttachment = attachments.find(att => att.filename === filename);
        if (!existingAttachment) {
          attachments.push({
            filename: filename,
            originalName: filename,
            mimeType: mimeType,
            size: 0, // Mail sağlayıcılarından gelen attachment'larda size bilgisi olmayabilir
            url: url
          });
        }
      }
    });

    console.log('=== ATTACHMENT PARSING COMPLETE ===');
    console.log('Final parsed attachments:', attachments);
    console.log('Total attachments found:', attachments.length);
    console.log('=====================================');

    // Otomatik etiketleme sistemi
    const autoLabels = [];
    const autoCategories = [];
    
    // Tüm mail sağlayıcılarından gelen mail için otomatik etiketleme
    if (sender.includes('@gmail.com') || sender.includes('@gozdedijital.xyz') || sender.includes('@outlook.com') || sender.includes('@hotmail.com') || sender.includes('@yahoo.com')) {
      console.log('Gmail mail detected, applying auto-labeling...');
      
      // Sosyal medya etiketleri
      const socialKeywords = ['facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'tiktok', 'snapchat', 'pinterest', 'reddit', 'discord', 'telegram', 'whatsapp'];
      const socialDomains = ['facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'snapchat.com', 'pinterest.com', 'reddit.com', 'discord.com', 'telegram.org', 'whatsapp.com'];
      
      // Güncellemeler etiketleri
      const updateKeywords = ['güncelleme', 'update', 'newsletter', 'bildirim', 'notification', 'duyuru', 'announcement'];
      const updateDomains = ['github.com', 'stackoverflow.com', 'medium.com', 'dev.to', 'hashnode.com'];
      
      // Forum etiketleri
      const forumKeywords = ['forum', 'community', 'discussion', 'tartışma', 'topluluk', 'soru', 'cevap', 'help', 'yardım'];
      const forumDomains = ['stackoverflow.com', 'reddit.com', 'quora.com', 'medium.com', 'dev.to'];
      
      // Alışveriş etiketleri
      const shoppingKeywords = ['sipariş', 'order', 'satın', 'purchase', 'fatura', 'invoice', 'ödeme', 'payment', 'kargo', 'shipping', 'teslimat', 'delivery'];
      const shoppingDomains = ['amazon.com', 'amazon.com.tr', 'trendyol.com', 'hepsiburada.com', 'n11.com', 'gittigidiyor.com', 'sahibinden.com'];
      
      // Promosyon etiketleri
      const promotionKeywords = ['indirim', 'discount', 'kampanya', 'campaign', 'promosyon', 'promotion', 'fırsat', 'opportunity', 'teklif', 'offer', 'kupon', 'coupon'];
      const promotionDomains = ['marketing', 'promo', 'sale', 'deal'];
      
      // İçerik analizi
      const contentToAnalyze = `${subject} ${bodyPlain}`.toLowerCase();
      const senderDomain = sender.split('@')[1]?.toLowerCase();
      
      console.log('Analyzing content:', { subject, senderDomain, contentLength: contentToAnalyze.length });
      
      // Sosyal etiket kontrolü
      if (socialKeywords.some(keyword => contentToAnalyze.includes(keyword)) || 
          socialDomains.some(domain => senderDomain?.includes(domain))) {
        autoLabels.push('social');
        autoCategories.push('social');
        console.log('Applied SOCIAL label');
      }
      
      // Güncellemeler etiket kontrolü
      if (updateKeywords.some(keyword => contentToAnalyze.includes(keyword)) || 
          updateDomains.some(domain => senderDomain?.includes(domain))) {
        autoLabels.push('updates');
        autoCategories.push('updates');
        console.log('Applied UPDATES label');
      }
      
      // Forum etiket kontrolü
      if (forumKeywords.some(keyword => contentToAnalyze.includes(keyword)) || 
          forumDomains.some(domain => senderDomain?.includes(domain))) {
        autoLabels.push('forums');
        autoCategories.push('forums');
        console.log('Applied FORUMS label');
      }
      
      // Alışveriş etiket kontrolü
      if (shoppingKeywords.some(keyword => contentToAnalyze.includes(keyword)) || 
          shoppingDomains.some(domain => senderDomain?.includes(domain))) {
        autoLabels.push('shopping');
        autoCategories.push('shopping');
        console.log('Applied SHOPPING label');
      }
      
      // Promosyon etiket kontrolü
      if (promotionKeywords.some(keyword => contentToAnalyze.includes(keyword)) || 
          promotionDomains.some(domain => senderDomain?.includes(domain))) {
        autoLabels.push('promotions');
        autoCategories.push('promotions');
        console.log('Applied PROMOTIONS label');
      }
    }
    
    console.log('Auto-generated labels:', autoLabels);
    console.log('Auto-generated categories:', autoCategories);

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
      labels: autoLabels, // Otomatik etiketler
      categories: autoCategories, // Otomatik kategoriler
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
    console.error('Webhook processing error:', error);
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


// Otomatik çöp kutusu temizleme - 30 gün önce silinen mailleri kalıcı olarak sil
const cleanupTrashMails = async () => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    console.log('Cleaning up trash mails older than:', thirtyDaysAgo);
    
    const result = await Mail.deleteMany({
      folder: 'trash',
      deletedAt: { $lt: thirtyDaysAgo }
    });
    
    console.log(`Cleaned up ${result.deletedCount} old trash mails`);
    return result.deletedCount;
  } catch (error) {
    console.error('Error cleaning up trash mails:', error);
    return 0;
  }
};

// Manuel çöp kutusu temizleme endpoint'i
const manualCleanupTrash = async (req, res, next) => {
  try {
    const deletedCount = await cleanupTrashMails();
    
    res.status(StatusCodes.OK).json({
      success: true,
      message: `${deletedCount} eski mail çöp kutusundan temizlendi`,
      deletedCount
    });
  } catch (error) {
    next(error);
  }
};

// Add Reply to Mail
const addReplyToMail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content, replyTo } = req.body;
    const userId = req.user.userId;

    if (!content) {
      throw new CustomError.BadRequestError("Cevap içeriği gereklidir");
    }

    // Orijinal maili bul
    const originalMail = await Mail.findOne({ _id: replyTo || id, user: userId });
    if (!originalMail) {
      throw new CustomError.NotFoundError("Orijinal mail bulunamadı");
    }

    // Kullanıcı bilgilerini al
    const user = await User.findById(userId);
    if (!user) {
      throw new CustomError.NotFoundError("Kullanıcı bulunamadı");
    }

    // Cevabı orijinal maile ekle
    const replyData = {
      sender: `${user.name} ${user.surname}`,
      content: content,
      isFromMe: true
    };

    await originalMail.addReply(replyData);

    // Mailgun ile cevabı gönder
    const mailgunData = {
      from: `${user.name} ${user.surname} <${user.mailAddress}>`,
      to: originalMail.from.email,
      subject: originalMail.subject.startsWith('Re:') ? originalMail.subject : `Re: ${originalMail.subject}`,
      text: content,
      html: content.replace(/\n/g, '<br>')
    };

    const mailgunResult = await mailgunService.sendMail(mailgunData);
    
    if (mailgunResult.success) {
      res.status(StatusCodes.OK).json({
        success: true,
        message: "Cevap başarıyla gönderildi ve mail'e eklendi",
        mail: originalMail,
        mailgunResult: mailgunResult
      });
    } else {
      // Mailgun hatası olsa bile cevap mail'e eklendi
      res.status(StatusCodes.OK).json({
        success: true,
        message: "Cevap mail'e eklendi ancak gönderimde hata oluştu",
        mail: originalMail,
        mailgunError: mailgunResult.error
      });
    }
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
  addReplyToMail,
  checkMailAddress,
  setupMailAddress,
  testMailgunConfig,
  createMailbox,
  listMailboxes,
  testWebhook,
  handleMailgunWebhook,
  cleanupTrashMails,
  manualCleanupTrash,
  testWebhook
};
