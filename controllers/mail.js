const Mail = require("../models/Mail");
const { User } = require("../models/User");
const { StatusCodes } = require("http-status-codes");
const CustomError = require("../errors");
const mailgunService = require("../services/mailgun.service");
const { uploadFileToCloudinary } = require("../helpers/uploadToCloudinary");
const mongoose = require("mongoose");

// Gmail attachment URL'sini düzelt
const fixGmailAttachmentUrl = (url) => {
  if (!url || typeof url !== 'string') return url;

  if (url.includes('mail.google.com')) {
    return url.replace('mail.google.com', 'mail-attachment.googleusercontent.com')
      .replace('/mail/u/0', '/attachment/u/0/');
  }

  return url;
};

// Taslak kaydetme
const saveDraft = async (req, res, next) => {
  try {
    const { to, subject, content, htmlContent, cc, bcc, labels, draftId } = req.body;
    const userId = req.user.userId;
    const files = req.files || [];

    console.log("saveDraft request body:", req.body);
    console.log("saveDraft files:", files);
    console.log("saveDraft userId:", userId);
    console.log("saveDraft draftId:", draftId);

    // Kullanıcıyı bul
    const user = await User.findById(userId);
    if (!user) {
      throw new CustomError.NotFoundError("Kullanıcı bulunamadı");
    }

    // Mail adresini kontrol et
    if (!user.mailAddress) {
      throw new CustomError.BadRequestError("Mail adresiniz tanımlanmamış");
    }

    // Parse JSON strings (eğer varsa)
    const recipients = to ? (Array.isArray(to) ? to : JSON.parse(to)) : [];
    const ccRecipients = cc ? (Array.isArray(cc) ? cc : JSON.parse(cc)) : [];
    const bccRecipients = bcc ? (Array.isArray(bcc) ? bcc : JSON.parse(bcc)) : [];

    // Prepare attachments
    const attachmentNames = req.body.attachmentNames ? JSON.parse(req.body.attachmentNames) : [];
    const attachmentTypes = req.body.attachmentTypes ? JSON.parse(req.body.attachmentTypes) : [];
    const attachmentUrls = req.body.attachmentUrls ? JSON.parse(req.body.attachmentUrls) : [];

    const attachments = files.map((file, index) => ({
      filename: attachmentNames[index] || file.originalname,
      data: file.buffer,
      contentType: attachmentTypes[index] || file.mimetype,
      size: file.size,
      url: attachmentUrls[index] || null
    }));

    // Eğer draftId varsa, mevcut taslağı güncelle
    if (draftId) {
      const existingDraft = await Mail.findOne({ _id: draftId, user: userId, folder: 'drafts' });
      
      if (existingDraft) {
        // Mevcut taslağı güncelle
        if (recipients.length > 0) {
          existingDraft.to = recipients.map(email => ({ email, name: email.split('@')[0] }));
        }
        if (ccRecipients.length > 0) {
          existingDraft.cc = ccRecipients.map(email => ({ email, name: email.split('@')[0] }));
        }
        if (bccRecipients.length > 0) {
          existingDraft.bcc = bccRecipients.map(email => ({ email, name: email.split('@')[0] }));
        }
        if (subject) existingDraft.subject = subject;
        if (content) existingDraft.content = content;
        if (htmlContent) existingDraft.htmlContent = htmlContent;
        if (attachments.length > 0) existingDraft.attachments = attachments;
        if (labels) existingDraft.labels = labels;

        await existingDraft.save();
        console.log("Draft updated:", existingDraft._id);

        return res.status(StatusCodes.OK).json({
          success: true,
          message: "Taslak güncellendi",
          draft: existingDraft
        });
      }
    }

    // Yeni taslak oluştur - unique messageId oluştur
    let draftMessageId = `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // MessageId'nin unique olduğundan emin ol
    let existingDraft = await Mail.findOne({ messageId: draftMessageId });
    while (existingDraft) {
      draftMessageId = `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      existingDraft = await Mail.findOne({ messageId: draftMessageId });
    }
    
    const mailData = {
      from: {
        email: user.mailAddress,
        name: `${user.name} ${user.surname}`
      },
      to: recipients.map(email => ({ email, name: email.split('@')[0] })),
      cc: ccRecipients.map(email => ({ email, name: email.split('@')[0] })),
      bcc: bccRecipients.map(email => ({ email, name: email.split('@')[0] })),
      subject: subject || '(Konusuz)',
      content: content || '',
      htmlContent: htmlContent || content || '',
      folder: 'drafts',
      status: 'draft',
      labels: labels || [],
      attachments: attachments || [],
      user: userId,
      messageId: draftMessageId
    };

    const draft = new Mail(mailData);
    await draft.save();
    console.log("Draft saved:", draft._id);

    // Kullanıcının mail listesine ekle
    user.mails.push(draft._id);
    await user.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Taslak kaydedildi",
      draft: draft
    });
  } catch (error) {
    next(error);
  }
};

// Taslakları getir
const getDrafts = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    const filter = { user: userId, folder: 'drafts' };
    const skip = (page - 1) * limit;

    const drafts = await Mail.find(filter)
      .populate('user', 'name surname mailAddress')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Mail.countDocuments(filter);

    res.status(StatusCodes.OK).json({
      success: true,
      mails: drafts,
      folder: 'drafts',
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

// Mail gönderme
const sendMail = async (req, res, next) => {
  try {
    const { to, subject, content, htmlContent, cc, bcc, labels, draftId, scheduledSendAt } = req.body;
    const userId = req.user.userId;
    const files = req.files || [];

    console.log("sendMail request body:", req.body);
    console.log("sendMail files:", files);
    console.log("sendMail userId:", userId);
    console.log("sendMail draftId:", draftId);
    console.log("sendMail scheduledSendAt:", scheduledSendAt);

    if (!to || !subject || !content) {
      throw new CustomError.BadRequestError("Alıcı, konu ve içerik gereklidir");
    }
    
    // Eğer planlı gönderim varsa, mail'i scheduled olarak kaydet
    if (scheduledSendAt) {
      const scheduledDate = new Date(scheduledSendAt);
      const now = new Date();
      
      if (scheduledDate <= now) {
        throw new CustomError.BadRequestError("Planlı gönderim tarihi gelecekte olmalıdır");
      }
      
      // Planlı mail olarak kaydet
      return await scheduleMailForLater(req, res, next);
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
      categories: [], // Normal maillerin promotions kategorisine düşmemesi için categories boş
      attachments: attachments || [],
      user: userId
    };

    // Mail'i veritabanına kaydet
    // messageId unique olmalı - rastgele bir ID oluştur
    let uniqueMessageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // MessageId'nin unique olduğundan emin ol
    let existingMail = await Mail.findOne({ messageId: uniqueMessageId });
    while (existingMail) {
      uniqueMessageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      existingMail = await Mail.findOne({ messageId: uniqueMessageId });
    }
    
    mailData.messageId = uniqueMessageId;
    
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
      // Mailgun'dan gelen messageId'yi ekle (varsa)
      if (mailgunResult.messageId) {
        mail.mailgunId = mailgunResult.messageId;
        mail.mailgunResponse = mailgunResult.response;
      }
      await mail.save();
      console.log("Mail status updated to 'sent' for ID:", mail._id);

      // Kullanıcının mail listesine ekle
      user.mails.push(mail._id);
      await user.save();
      console.log("Mail added to user's mail list. User ID:", userId);

      // Optional internal delivery fallback for same-domain recipients
      if ((process.env.INTERNAL_DELIVERY_FALLBACK || '').toLowerCase() !== 'false') {
        console.log('[INTERNAL_FALLBACK] Enabled for normal send');
        const domain = process.env.MAIL_DOMAIN || 'gozdedijital.xyz';
        for (const recipient of recipients) {
          if (recipient.endsWith(`@${domain}`)) {
            console.log(`[INTERNAL_FALLBACK] Creating inbox copy for ${recipient}`);
            const recipientUser = await User.findOne({ mailAddress: recipient });
            if (recipientUser) {
              console.log(`[INTERNAL_FALLBACK] Recipient user found: ${recipientUser._id}`);
              // Skip if webhook likely already created it (same mailgunId)
              if (mailgunResult.messageId) {
                const dup = await Mail.findOne({ user: recipientUser._id, mailgunId: mailgunResult.messageId });
                if (dup) {
                  console.log('[INTERNAL_FALLBACK] Skipped creating inbox copy (already exists via webhook)');
                  continue;
                }
              }
              let inboxMessageId = `inbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              let existingInboxMail = await Mail.findOne({ messageId: inboxMessageId });
              while (existingInboxMail) {
                inboxMessageId = `inbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                existingInboxMail = await Mail.findOne({ messageId: inboxMessageId });
              }
              const inboxMailData = {
                from: { email: user.mailAddress, name: `${user.name} ${user.surname}` },
                to: [{ email: recipient, name: recipient.split('@')[0] }],
                cc: ccRecipients.map(email => ({ email, name: email.split('@')[0] })),
                bcc: bccRecipients.map(email => ({ email, name: email.split('@')[0] })),
                subject,
                content,
                htmlContent: htmlContent || content,
                folder: 'inbox',
                status: 'delivered',
                isRead: false,
                labels: labels || [],
                categories: [], // Normal maillerin promotions kategorisine düşmemesi için categories boş
                attachments: attachments || [],
                user: recipientUser._id,
                messageId: inboxMessageId,
                inReplyTo: undefined,
                receivedAt: new Date(),
                mailgunId: mailgunResult.messageId
              };
              const inboxMail = new Mail(inboxMailData);
              await inboxMail.save();
              recipientUser.mails.push(inboxMail._id);
              await recipientUser.save();
              console.log(`[INTERNAL_FALLBACK] Inbox copy created: ${inboxMail._id}`);
            }
          }
        }
      }

      console.log("Mail sent successfully:", mail._id);
      console.log("Final mail folder:", mail.folder);
      console.log("Final mail status:", mail.status);

      // Eğer taslaktan gönderiyorsak, taslağı sil
      if (draftId) {
        try {
          await Mail.findByIdAndDelete(draftId);
          console.log("Draft deleted after sending:", draftId);
        } catch (deleteError) {
          console.error("Error deleting draft:", deleteError);
          // Taslak silme hatası mail gönderme işlemini etkilemesin
        }
      }

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
        },
        deletedDraftId: draftId || null
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

// Yıldızlı mailleri getir
const getStarredMails = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20, search, isRead } = req.query;

    const filter = {
      user: userId,
      isStarred: true,
      folder: { $ne: 'trash' } // Çöp kutusundaki yıldızlı mailleri gösterme
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
      .sort({ receivedAt: -1, createdAt: -1 })
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
          // Gönderilen kutusu için toplam sayı (okunmamış değil)
          sent: { $sum: { $cond: [{ $eq: ['$folder', 'sent'] }, 1, 0] } },
          drafts: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'drafts'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          spam: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'spam'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          trash: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'trash'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          archive: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'archive'] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          // Yıldızlı maillerin toplam sayısı (çöp kutusundakiler hariç)
          starred: { $sum: { $cond: [{ $and: [{ $eq: ['$isStarred', true] }, { $ne: ['$folder', 'trash'] }] }, 1, 0] } },
          // Kategori okunmamış sayıları - sadece okunmamış mailleri say
          social: { $sum: { $cond: [{ $and: [{ $in: ['social', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          updates: { $sum: { $cond: [{ $and: [{ $in: ['updates', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          forums: { $sum: { $cond: [{ $and: [{ $in: ['forums', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          shopping: { $sum: { $cond: [{ $and: [{ $in: ['shopping', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          promotions: { $sum: { $cond: [{ $and: [{ $in: ['promotions', { $ifNull: ['$categories', []] }] }, { $eq: ['$isRead', false] }] }, 1, 0] } },
          scheduled: { $sum: { $cond: [{ $and: [{ $eq: ['$folder', 'scheduled'] }, { $eq: ['$status', 'scheduled'] }] }, 1, 0] } }
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
      starred: 0,
      social: 0,
      updates: 0,
      forums: 0,
      shopping: 0,
      promotions: 0,
      scheduled: 0
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
      webhookUrl: process.env.WEBHOOK_URL || 'http://localhost:5003/v1/mail/webhook'
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

// Mail authentication durumunu kontrol et (DKIM, DMARC, SPF)
const checkMailAuthentication = async (req, res, next) => {
  try {
    const result = await mailgunService.checkMailAuthentication();
    
    res.status(StatusCodes.OK).json({
      success: true,
      message: "Mail authentication durumu kontrol edildi",
      result: result
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
    console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
    console.log('📎 Files:', req.files ? req.files.map(f => ({ fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, size: f.size })) : 'No files');
    console.log('📄 Content-Type:', req.headers['content-type']);
    
    // Gmail kontrolü - tüm olası sender alanlarını kontrol et
    const sender = req.body?.sender || req.body?.from || req.body?.['Return-Path'] || req.body?.['X-Sender'] || '';
    const senderEmail = typeof sender === 'string' ? sender : '';
    
    if (senderEmail && (senderEmail.includes('@gmail.com') || senderEmail.includes('googlemail.com'))) {
      console.log('📧 ===== GMAIL MAIL DETECTED! =====');
      console.log('📧 Sender:', sender);
      console.log('📧 Recipient:', req.body?.recipient);
      console.log('📧 Subject:', req.body?.subject);
      console.log('📧 Message-ID:', req.body?.['Message-Id'] || req.body?.['message-id']);
      console.log('📧 In-Reply-To:', req.body?.['In-Reply-To'] || req.body?.['in-reply-to']);
      console.log('📧 References:', req.body?.['References'] || req.body?.['references']);
      console.log('📧 Spam Score:', req.body?.['X-Mailgun-Sscore'] || req.body?.['X-Spam-Score']);
      console.log('📧 Spam Flag:', req.body?.['X-Mailgun-Flag'] || req.body?.['X-Spam-Flag']);
      
      // Tüm Gmail/Google ile ilgili key'leri listele
      const gmailKeys = Object.keys(req.body || {}).filter(k => 
        k.toLowerCase().includes('gmail') || 
        k.toLowerCase().includes('google') ||
        k.toLowerCase().includes('sender') ||
        k.toLowerCase().includes('from') ||
        k.toLowerCase().includes('reply')
      );
      console.log('📧 Gmail-related keys:', gmailKeys);
      console.log('📧 ==================================');
    }
    
    // Reply kontrolü
    const subject = req.body?.subject || '';
    const isReplyFromSubject = subject.toLowerCase().startsWith('re:') || 
                              subject.toLowerCase().startsWith('fw:') || 
                              subject.toLowerCase().startsWith('fwd:');
    if (isReplyFromSubject || req.body?.['In-Reply-To'] || req.body?.['in-reply-to']) {
      console.log('📧 ===== REPLY MAIL DETECTED! =====');
      console.log('📧 Subject:', subject);
      console.log('📧 In-Reply-To:', req.body?.['In-Reply-To'] || req.body?.['in-reply-to']);
      console.log('📧 References:', req.body?.['References'] || req.body?.['references']);
      console.log('📧 =================================');
    }
    
    console.log('================================');

    let webhookData = req.body;

    // Eğer files varsa, bunları Cloudinary'ye yükle ve webhookData'ya ekle
    if (req.files && req.files.length > 0) {
      console.log('Processing uploaded files...');
      
      // Tüm dosyaları Cloudinary'ye yükle (paralel)
      const uploadPromises = req.files.map(async (file, index) => {
        console.log(`File ${index}:`, {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });

        try {
          // Cloudinary'ye yükle
          const cloudinaryUrl = await uploadFileToCloudinary(
            file.buffer,
            file.originalname,
            file.mimetype
          );
          
          console.log(`✅ Uploaded to Cloudinary: ${file.originalname} -> ${cloudinaryUrl}`);
          
          return {
            index,
            file,
            cloudinaryUrl
          };
        } catch (error) {
          console.error(`❌ Failed to upload ${file.originalname} to Cloudinary:`, error);
          
          // Hata durumunda da devam et ama URL olmadan
          return {
            index,
            file,
            cloudinaryUrl: null
          };
        }
      });

      // Tüm yüklemelerin tamamlanmasını bekle
      const uploadResults = await Promise.all(uploadPromises);
      
      // Sonuçları webhookData'ya ekle
      uploadResults.forEach(({ index, file, cloudinaryUrl }) => {
        const attachmentIndex = index + 1;
        webhookData[`attachment-${attachmentIndex}`] = file.originalname;
        webhookData[`attachment-${attachmentIndex}-content-type`] = file.mimetype;
        webhookData[`attachment-${attachmentIndex}-size`] = file.size.toString();
        
        // Cloudinary URL'sini kullan
        if (cloudinaryUrl) {
          webhookData[`attachment-${attachmentIndex}-url`] = cloudinaryUrl;
          console.log(`✅ Cloudinary URL saved for ${file.originalname}: ${cloudinaryUrl}`);
        } else {
          console.log(`⚠️ No Cloudinary URL for ${file.originalname}, will try alternative sources`);
        }
      });

      // Eski Gmail URL bulma kodunu koruyalım (fallback için - Cloudinary başarısız olursa)
      req.files.forEach((file, index) => {
        const attachmentIndex = index + 1;

        // Eğer Cloudinary URL'si yoksa Gmail attachment URL'sini bul
        if (!webhookData[`attachment-${attachmentIndex}-url`]) {
          let attachmentUrl = webhookData[`${file.fieldname}-url`] ||
            webhookData[`url-${attachmentIndex}`] ||
            null;

          if (attachmentUrl) {
            // Gmail attachment URL'sini düzelt
            const fixedUrl = fixGmailAttachmentUrl(attachmentUrl);
            webhookData[`attachment-${attachmentIndex}-url`] = fixedUrl;
            console.log(`Found attachment URL for ${file.originalname}: ${fixedUrl}`);
          } else {
            // Gmail attachment URL'sini content-id-map'ten çıkarmaya çalış
            const contentIdMap = webhookData['content-id-map'];
            if (contentIdMap) {
              try {
                const idMap = JSON.parse(contentIdMap);
                const contentIds = Object.keys(idMap);
                if (contentIds.length > index) {
                  const contentId = contentIds[index];
                  // Gmail attachment URL formatı - Message-Id'yi encode et
                  const messageId = encodeURIComponent(webhookData['Message-Id']);
                  const realAttId = contentId.replace('<', '').replace('>', '');
                  const gmailUrl = `https://mail-attachment.googleusercontent.com/attachment/u/0/?ui=2&ik=7ac7c89a8e&attid=0.${attachmentIndex}&permmsgid=${messageId}&th=${messageId}&view=att&disp=safe&realattid=${realAttId}&zw`;
                  webhookData[`attachment-${attachmentIndex}-url`] = gmailUrl;
                  console.log(`Generated Gmail URL for ${file.originalname}: ${gmailUrl}`);
                }
              } catch (e) {
                console.log('Could not parse content-id-map:', e.message);
              }
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

// Basit email çıkarma helper'ı ("Name <mail@domain>" → "mail@domain")
const extractEmailAddress = (value) => {
  if (!value || typeof value !== 'string') {
    console.log('⚠️ extractEmailAddress: Invalid value (not a string):', value);
    return value;
  }
  
  const originalValue = value;
  const match = value.match(/<([^>]+)>/);
  if (match && match[1]) {
    const extracted = match[1].trim();
    if (extracted.includes('@gmail.com')) {
      console.log('📧 Gmail email extracted:', { original: originalValue, extracted });
    }
    return extracted;
  }
  
  // Eğer < > yoksa ve boşluk içeriyorsa son parçayı seç (çoğu durumda email olur)
  if (value.includes(' ') && value.includes('@')) {
    const parts = value.split(/\s+/);
    const emailPart = parts.find((p) => p.includes('@'));
    const result = emailPart ? emailPart.replace(/["'<>]/g, '').trim() : value.trim();
    if (result.includes('@gmail.com')) {
      console.log('📧 Gmail email extracted (space-separated):', { original: originalValue, extracted: result });
    }
    return result;
  }
  
  const trimmed = value.trim();
  if (trimmed.includes('@gmail.com')) {
    console.log('📧 Gmail email (direct):', trimmed);
  }
  return trimmed;
};

// Webhook data işleme fonksiyonu
const processWebhookData = async (webhookData, res) => {
  // Webhook data'yı sakla (hata durumunda kullanmak için)
  const originalWebhookData = webhookData;
  
  try {
    console.log('=== PROCESSING WEBHOOK DATA ===');
    console.log('📧 Webhook data keys:', Object.keys(webhookData));
    console.log('📧 Full webhook data:', JSON.stringify(webhookData, null, 2));
    
    // Mailgun webhook verisini kontrol et - recipient'ı farklı alanlarda ara
    let recipient = webhookData['recipient'] || 
                    webhookData['To'] || 
                    webhookData['to'] || 
                    webhookData['X-Recipient'] ||
                    webhookData['X-Original-To'] ||
                    null;
    
    if (!recipient && webhookData['to'] && typeof webhookData['to'] === 'string') {
      // "Name <email@domain>" formatından email'i çıkar
      recipient = extractEmailAddress(webhookData['to']);
    }
    
    if (!webhookData || !recipient) {
      console.log('❌ Invalid webhook data - missing recipient');
      console.log('Available keys:', Object.keys(webhookData || {}));
      console.log('All recipient-related keys:', Object.keys(webhookData || {}).filter(k => 
        k.toLowerCase().includes('recipient') || 
        k.toLowerCase().includes('to') ||
        k.toLowerCase() === 'to'
      ));
      return res.status(StatusCodes.OK).json({ message: 'Webhook received but no recipient' });
    }
    
    console.log('✅ Recipient found:', recipient);
    
    // Mailgun webhook verilerini parse et
    const senderRaw = webhookData['sender'] || webhookData['from'] || webhookData['Return-Path'] || webhookData['X-Sender'] || 'unknown@example.com';
    const sender = extractEmailAddress(senderRaw);
    const subject = webhookData['subject'] || 'No Subject';
    const bodyPlain = webhookData['body-plain'] || webhookData['stripped-text'] || webhookData['body-plain'] || '';
    const bodyHtml = webhookData['body-html'] || webhookData['stripped-html'] || webhookData['body-html'] || '';
    const timestamp = webhookData['timestamp'] ? parseInt(webhookData['timestamp']) : Date.now() / 1000;
    const messageId = webhookData['Message-Id'] || webhookData['message-id'] || webhookData['Message-ID'] || webhookData['message_id'] || `mg-${Date.now()}`;

    // Spam kontrolü - Mailgun spam score
    const spamScore = webhookData['X-Mailgun-Sscore'] || webhookData['X-Spam-Score'] || webhookData['spam-score'] || null;
    const isSpam = webhookData['X-Mailgun-Flag'] === 'yes' || 
                   webhookData['X-Spam-Flag'] === 'yes' || 
                   (spamScore && parseFloat(spamScore) > 5.0);
    
    // Reply kontrolü - Subject veya header'lardan
    const isReply = subject.toLowerCase().startsWith('re:') || 
                   subject.toLowerCase().startsWith('fw:') || 
                   subject.toLowerCase().startsWith('fwd:') ||
                   webhookData['In-Reply-To'] || 
                   webhookData['in-reply-to'] ||
                   webhookData['References'] ||
                   webhookData['references'];

    console.log('📨 Parsed email data:');
    console.log('   Recipient:', recipient);
    console.log('   Sender Raw:', senderRaw);
    console.log('   Sender (extracted):', sender);
    console.log('   Subject:', subject);
    console.log('   Message ID:', messageId);
    console.log('   Is Gmail?', sender.includes('@gmail.com'));
    console.log('   Spam Score:', spamScore);
    console.log('   Is Spam?', isSpam);
    console.log('   Is Reply?', isReply);
    console.log('   Body Plain length:', bodyPlain.length);
    console.log('   Body HTML length:', bodyHtml.length);
    
    // Gmail için özel loglar
    if (sender.includes('@gmail.com')) {
      console.log('📧 GMAIL MAIL DETAILS:');
      console.log('   Full sender raw:', senderRaw);
      console.log('   All Gmail-related keys:', Object.keys(webhookData).filter(k => k.toLowerCase().includes('gmail') || k.toLowerCase().includes('google')));
      console.log('   Headers:', JSON.stringify(Object.keys(webhookData).reduce((acc, key) => {
        if (key.toLowerCase().includes('header') || key.toLowerCase().includes('x-')) {
          acc[key] = webhookData[key];
        }
        return acc;
      }, {}), null, 2));
    }

    // Parse threading headers
    const inReplyToHeader = webhookData['In-Reply-To'] || webhookData['in-reply-to'] || null;
    let referencesHeader = webhookData['References'] || webhookData['references'] || null;
    let referencesArray = [];
    if (referencesHeader) {
      try {
        // References header can be a space-separated list of message IDs
        referencesArray = referencesHeader
          .toString()
          .split(/\s+/)
          .map(ref => ref.trim())
          .filter(Boolean);
      } catch (e) {
        referencesArray = [];
      }
    }

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

    console.log('📨 Processing mail:', {
      recipient,
      sender,
      senderName,
      subject,
      messageId,
      timestamp: new Date(timestamp * 1000),
      isReply: isReply,
      isGmail: sender.includes('@gmail.com'),
      isSpam: isSpam,
      spamScore: spamScore
    });
    
    // Spam olarak işaretlenmiş olsa bile yakalayalım (spam klasörüne koyarız)
    if (isSpam) {
      console.log('⚠️ Mail spam olarak işaretlenmiş, yine de yakalıyoruz (spam klasörüne gidecek)');
    }

    // Alıcı kullanıcıyı bul - mailAddress alanında ara
    console.log('🔍 Searching for recipient user with mailAddress:', recipient);
    const recipientUser = await User.findOne({ mailAddress: recipient });

    if (!recipientUser) {
      console.log('❌ Recipient user not found for mail address:', recipient);
      console.log('🔍 Attempting to find user by email in database...');
      
      // Alternatif arama - belki farklı bir formatta kaydedilmiş olabilir
      const allUsers = await User.find({}).select('mailAddress name').limit(10);
      console.log('📋 Sample users in database:', allUsers.map(u => ({ id: u._id, mailAddress: u.mailAddress, name: u.name })));
      
      return res.status(StatusCodes.OK).json({
        message: 'User not found but webhook accepted',
        recipient: recipient
      });
    }

    console.log('✅ Recipient user found:', {
      userId: recipientUser._id,
      name: recipientUser.name,
      mailAddress: recipientUser.mailAddress
    });

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
            // Gmail attachment URL'sini düzelt
            const fixedUrl = fixGmailAttachmentUrl(attachmentUrl);

            attachments.push({
              filename: attachmentName,
              originalName: attachmentName,
              mimeType: attachmentType || 'application/octet-stream',
              size: attachmentSize ? parseInt(attachmentSize) : 0,
              url: fixedUrl || null
            });
            console.log(`Added attachment: ${attachmentName} with URL: ${fixedUrl || 'null'}`);
          }
        }
      }
    }

    // Gmail'den gelen attachment'ları da kontrol et (sadece multer işlemediyse)
    if (!webhookData['_multerProcessed'] && webhookData['attachments'] && Array.isArray(webhookData['attachments'])) {
      console.log('Gmail attachments array:', webhookData['attachments']);
      webhookData['attachments'].forEach((attachment, index) => {
        if (attachment.filename || attachment.name) {
          // Gmail attachment URL'sini düzelt
          const fixedUrl = fixGmailAttachmentUrl(attachment.url);

          attachments.push({
            filename: attachment.filename || attachment.name,
            originalName: attachment.filename || attachment.name,
            mimeType: attachment.contentType || attachment.mimeType || 'application/octet-stream',
            size: attachment.size || 0,
            url: fixedUrl || null
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

            // Gmail attachment URL'sini düzelt
            const fixedUrl = fixGmailAttachmentUrl(attachmentUrl);

            attachments.push({
              filename: attachmentName,
              originalName: attachmentName,
              mimeType: attachmentType || 'application/octet-stream',
              size: attachmentSize ? parseInt(attachmentSize) : 0,
              url: fixedUrl || null
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
              // Gmail attachment URL'sini düzelt
              const fixedUrl = fixGmailAttachmentUrl(url);

              attachments.push({
                filename: filename,
                originalName: filename,
                mimeType: mimeType,
                size: 0, // Gmail'den gelen attachment'larda size bilgisi olmayabilir
                url: fixedUrl
              });
              console.log(`Added Gmail attachment: ${filename}`);
            }
          }
        }
      });
      }
    }

    // Tüm mail sağlayıcılarının özel attachment formatlarını kontrol et (sadece multer işlemediyse)
    // Gmail, Outlook, Yahoo vb. bazen attachment'ları farklı key'lerle gönderebilir
    if (!webhookData['_multerProcessed']) {
      const attachmentKeys = Object.keys(webhookData).filter(key =>
        (key.toLowerCase().includes('attachment') ||
          key.toLowerCase().includes('file') ||
          key.toLowerCase().includes('document') ||
          key.toLowerCase().includes('image') ||
          key.toLowerCase().includes('photo') ||
          key.toLowerCase().includes('attach') ||
          key.toLowerCase().includes('media')) &&
        !key.includes('count') &&
        !key.includes('url') &&
        !key.includes('size') &&
        !key.includes('content-type') &&
        !key.includes('_multerProcessed')
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
            // Gmail attachment URL'sini düzelt
            const fixedUrl = fixGmailAttachmentUrl(url);

            attachments.push({
              filename: filename,
              originalName: filename,
              mimeType: mimeType,
              size: 0, // Mail sağlayıcılarından gelen attachment'larda size bilgisi olmayabilir
              url: fixedUrl
            });
          }
        }
      });
    }

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

    // Optional auto-categorization (disabled by default)
    const isAutoCategorizationEnabled = (process.env.AUTO_CATEGORIZATION || '').toLowerCase() === 'true';
    if (!isAutoCategorizationEnabled) {
      console.log('Auto-categorization disabled (set AUTO_CATEGORIZATION=true to enable)');
      autoLabels.length = 0;
      autoCategories.length = 0;
    }
    console.log('Auto-generated labels:', autoLabels);
    console.log('Auto-generated categories:', autoCategories);

    // MessageId'nin unique olduğundan emin ol
    console.log('🔍 Checking for duplicate messageId:', messageId);
    let uniqueMessageId = messageId;
    const existingMail = await Mail.findOne({ messageId: messageId });
    if (existingMail) {
      // Eğer aynı messageId varsa, yeni bir tane oluştur
      uniqueMessageId = `${messageId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log(`⚠️ Duplicate messageId detected, using new one: ${uniqueMessageId}`);
    } else {
      console.log('✅ MessageId is unique');
    }

    // Duplicate guard by mailgunId (Message-Id) to avoid double delivery with internal fallback
    console.log('🔍 Checking for duplicate mailgunId:', messageId);
    const existingByMailgunId = await Mail.findOne({ user: recipientUser._id, mailgunId: messageId });
    if (existingByMailgunId) {
      console.log('⚠️ Duplicate webhook delivery detected, skipping mail creation for Message-Id:', messageId);
      console.log('📋 Existing mail ID:', existingByMailgunId._id);
      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Duplicate ignored',
        mailgunId: messageId
      });
    } else {
      console.log('✅ No duplicate mailgunId found');
    }

    // Mail objesi oluştur
    console.log('📝 Creating mail object...');
    
    // Folder belirleme: Spam ise spam klasörüne, değilse inbox'a
    // Spam olsa bile yakalıyoruz (kullanıcı kontrol edebilir)
    const mailFolder = isSpam ? 'spam' : 'inbox';
    
    // Gmail ve reply kontrolü
    if (sender.includes('@gmail.com')) {
      console.log('📧 Gmail mail yakalanıyor - folder:', mailFolder);
    }
    if (isReply) {
      console.log('📧 Reply mail yakalanıyor - folder:', mailFolder);
    }
    
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
      folder: mailFolder, // Spam ise spam, değilse inbox
      status: 'delivered',
      isRead: false,
      receivedAt: new Date(timestamp * 1000), // Unix timestamp to Date
      messageId: uniqueMessageId,
      inReplyTo: inReplyToHeader || undefined,
      references: referencesArray.length ? referencesArray : undefined,
      mailgunId: messageId,
      user: recipientUser._id,
      labels: autoLabels, // Otomatik etiketler
      categories: autoCategories, // Otomatik kategoriler
      attachments: attachments, // Attachment'ları ekle
      spamScore: spamScore ? parseFloat(spamScore) : null // Spam score'u kaydet
    };

    console.log('📧 Mail data prepared:', {
      from: mailData.from,
      to: mailData.to,
      subject: mailData.subject,
      messageId: mailData.messageId,
      attachmentsCount: mailData.attachments.length,
      labels: mailData.labels,
      categories: mailData.categories
    });

    // Mail'i veritabanına kaydet
    console.log('💾 Saving mail to database...');
    const mail = new Mail(mailData);
    await mail.save();
    console.log('✅ Mail saved successfully with ID:', mail._id);

    // Kullanıcının mail listesine ekle (eğer mails array'i varsa)
    if (recipientUser.mails) {
      console.log('📋 Adding mail to user mails array...');
      recipientUser.mails.push(mail._id);
      await recipientUser.save();
      console.log('✅ Mail added to user mails array');
    } else {
      console.log('⚠️ User mails array does not exist, skipping...');
    }

    console.log('✅ Mail saved successfully:', {
      mailId: mail._id,
      recipient: recipient,
      subject: subject,
      sender: sender,
      isGmail: sender.includes('@gmail.com'),
      receivedAt: mail.receivedAt,
      attachmentsCount: attachments.length
    });
    console.log('=== WEBHOOK PROCESSING COMPLETE ===');

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Mail received and saved',
      mailId: mail._id,
      recipient: recipient
    });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    
    // Gmail'den gelen mail için özel log
    try {
      if (originalWebhookData && originalWebhookData['sender']) {
        const sender = extractEmailAddress(originalWebhookData['sender'] || originalWebhookData['from'] || originalWebhookData['Return-Path'] || '');
        if (sender.includes('@gmail.com')) {
          console.error('🚨 GMAIL MAIL PROCESSING ERROR:', {
            sender: sender,
            recipient: originalWebhookData['recipient'],
            subject: originalWebhookData['subject'],
            error: error.message,
            errorStack: error.stack
          });
        }
      }
    } catch (logError) {
      console.error('Error logging Gmail details:', logError);
    }
    
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

// Gmail attachment URL'lerini düzelt
const fixGmailAttachmentUrls = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Kullanıcının tüm maillerini bul
    const mails = await Mail.find({ user: userId });
    let fixedCount = 0;

    for (const mail of mails) {
      if (mail.attachments && Array.isArray(mail.attachments)) {
        let hasChanges = false;

        for (const attachment of mail.attachments) {
          if (attachment.url && attachment.url.includes('mail.google.com')) {
            attachment.url = fixGmailAttachmentUrl(attachment.url);
            hasChanges = true;
            fixedCount++;
          }
        }

        if (hasChanges) {
          await mail.save();
        }
      }
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: `${fixedCount} Gmail attachment URL'si düzeltildi`,
      fixedCount
    });
  } catch (error) {
    next(error);
  }
};

// Planlı mail kaydetme
const scheduleMailForLater = async (req, res, next) => {
  try {
    const { to, subject, content, htmlContent, cc, bcc, labels, draftId, scheduledSendAt } = req.body;
    const userId = req.user.userId;
    const files = req.files || [];

    console.log("scheduleMailForLater request body:", req.body);

    // Kullanıcıyı bul
    const user = await User.findById(userId);
    if (!user) {
      throw new CustomError.NotFoundError("Kullanıcı bulunamadı");
    }

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

    const attachments = files.map((file, index) => ({
      filename: attachmentNames[index] || file.originalname,
      data: file.buffer,
      contentType: attachmentTypes[index] || file.mimetype,
      size: file.size,
      url: attachmentUrls[index] || null
    }));

    // Unique messageId oluştur
    let uniqueMessageId = `scheduled-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let existingMail = await Mail.findOne({ messageId: uniqueMessageId });
    while (existingMail) {
      uniqueMessageId = `scheduled-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      existingMail = await Mail.findOne({ messageId: uniqueMessageId });
    }

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
      folder: 'scheduled',
      status: 'scheduled',
      labels: labels || [],
      categories: [], // Normal maillerin promotions kategorisine düşmemesi için categories boş
      attachments: attachments || [],
      user: userId,
      messageId: uniqueMessageId,
      scheduledSendAt: new Date(scheduledSendAt)
    };

    // Mail'i veritabanına kaydet
    const mail = new Mail(mailData);
    await mail.save();
    console.log("Scheduled mail saved to database with ID:", mail._id);

    // Kullanıcının mail listesine ekle
    user.mails.push(mail._id);
    await user.save();

    // Eğer taslaktan planlıyorsak, taslağı sil
    if (draftId) {
      try {
        await Mail.findByIdAndDelete(draftId);
        console.log("Draft deleted after scheduling:", draftId);
      } catch (deleteError) {
        console.error("Error deleting draft:", deleteError);
      }
    }

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Mail ${new Date(scheduledSendAt).toLocaleString('tr-TR')} tarihinde gönderilmek üzere planlandı`,
      mail: {
        _id: mail._id,
        subject: mail.subject,
        to: mail.to,
        status: mail.status,
        folder: mail.folder,
        scheduledSendAt: mail.scheduledSendAt
      },
      deletedDraftId: draftId || null
    });
  } catch (error) {
    next(error);
  }
};

// Planlı mailleri getir
const getScheduledMails = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    const filter = { user: userId, folder: 'scheduled', status: 'scheduled' };
    const skip = (page - 1) * limit;

    const mails = await Mail.find(filter)
      .populate('user', 'name surname mailAddress')
      .sort({ scheduledSendAt: 1 }) // En yakın tarihli önce
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Mail.countDocuments(filter);

    res.status(StatusCodes.OK).json({
      success: true,
      mails: mails,
      folder: 'scheduled',
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

// Planlı mail'i iptal et
const cancelScheduledMail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const mail = await Mail.findOne({ _id: id, user: userId, status: 'scheduled' });
    if (!mail) {
      throw new CustomError.NotFoundError("Planlı mail bulunamadı");
    }

    // Mail'i taslak olarak değiştir
    mail.status = 'draft';
    mail.folder = 'drafts';
    mail.scheduledSendAt = undefined;
    await mail.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Planlı gönderim iptal edildi ve mail taslak olarak kaydedildi",
      mail: mail
    });
  } catch (error) {
    next(error);
  }
};

// Planlı mail'i düzenle
const updateScheduledMail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledSendAt, to, subject, content, htmlContent, cc, bcc } = req.body;
    const userId = req.user.userId;
    const files = req.files || [];

    console.log("updateScheduledMail request body:", req.body);
    console.log("updateScheduledMail files:", files);

    const mail = await Mail.findOne({ _id: id, user: userId, status: 'scheduled', folder: 'scheduled' });
    if (!mail) {
      throw new CustomError.NotFoundError("Planlı mail bulunamadı");
    }

    // Tarih güncelleniyorsa kontrol et
    if (scheduledSendAt) {
      const scheduledDate = new Date(scheduledSendAt);
      const now = new Date();
      
      if (scheduledDate <= now) {
        throw new CustomError.BadRequestError("Planlı gönderim tarihi gelecekte olmalıdır");
      }
      
      mail.scheduledSendAt = scheduledDate;
    }

    // Diğer alanları güncelle
    if (to) {
      const recipients = Array.isArray(to) ? to : JSON.parse(to);
      mail.to = recipients.map(email => ({ email, name: email.split('@')[0] }));
    }
    
    if (cc) {
      const ccRecipients = Array.isArray(cc) ? cc : JSON.parse(cc);
      mail.cc = ccRecipients.map(email => ({ email, name: email.split('@')[0] }));
    }
    
    if (bcc) {
      const bccRecipients = Array.isArray(bcc) ? bcc : JSON.parse(bcc);
      mail.bcc = bccRecipients.map(email => ({ email, name: email.split('@')[0] }));
    }
    
    if (subject !== undefined) mail.subject = subject;
    if (content !== undefined) mail.content = content;
    if (htmlContent !== undefined) mail.htmlContent = htmlContent;

    // Attachment'ları güncelle
    if (files.length > 0) {
      const attachmentNames = req.body.attachmentNames ? JSON.parse(req.body.attachmentNames) : [];
      const attachmentTypes = req.body.attachmentTypes ? JSON.parse(req.body.attachmentTypes) : [];
      const attachmentUrls = req.body.attachmentUrls ? JSON.parse(req.body.attachmentUrls) : [];

      const newAttachments = files.map((file, index) => ({
        filename: attachmentNames[index] || file.originalname,
        data: file.buffer,
        contentType: attachmentTypes[index] || file.mimetype,
        size: file.size,
        url: attachmentUrls[index] || null
      }));

      // Mevcut attachment'ları koru ve yenilerini ekle
      mail.attachments = [...(mail.attachments || []), ...newAttachments];
    }

    await mail.save();

    res.status(StatusCodes.OK).json({
      success: true,
      message: "Planlı mail başarıyla güncellendi",
      mail: mail
    });
  } catch (error) {
    next(error);
  }
};

// Planlı mailleri kontrol et ve gönder (cron job için)
const processScheduledMails = async () => {
  try {
    const now = new Date();
    console.log(`[${now.toISOString()}] Checking for scheduled mails to send...`);

    // Gönderilmesi gereken planlı mailleri bul
    const scheduledMails = await Mail.find({
      status: 'scheduled',
      folder: 'scheduled',
      scheduledSendAt: { $lte: now }
    }).populate('user', 'name surname mailAddress');

    console.log(`Found ${scheduledMails.length} scheduled mails to send`);

    for (const mail of scheduledMails) {
      try {
        console.log(`Processing scheduled mail: ${mail._id}`);

        // Kullanıcı bilgilerini kontrol et
        if (!mail.user || !mail.user.mailAddress) {
          console.error(`User not found or no mail address for mail: ${mail._id}`);
          mail.status = 'failed';
          await mail.save();
          continue;
        }

        // Mailgun ile gönder
        const mailgunData = {
          from: `${mail.from.name} <${mail.from.email}>`,
          to: mail.to.map(r => r.email).join(', '),
          subject: mail.subject,
          text: mail.content,
          html: mail.htmlContent || mail.content,
          attachments: mail.attachments || []
        };

        if (mail.cc && mail.cc.length > 0) {
          mailgunData.cc = mail.cc.map(r => r.email).join(', ');
        }
        if (mail.bcc && mail.bcc.length > 0) {
          mailgunData.bcc = mail.bcc.map(r => r.email).join(', ');
        }

        console.log("Sending scheduled mail via Mailgun:", mail._id);
        const mailgunResult = await mailgunService.sendMail(mailgunData);

        if (mailgunResult.success) {
          // Mail durumunu güncelle
          mail.status = 'sent';
          mail.folder = 'sent';
          mail.sentAt = new Date();
          if (mailgunResult.messageId) {
            mail.mailgunId = mailgunResult.messageId;
            mail.mailgunResponse = mailgunResult.response;
          }
          await mail.save();
          console.log(`Scheduled mail sent successfully: ${mail._id}`);

      // Optional internal delivery fallback for scheduled mails to same-domain recipients
      if ((process.env.INTERNAL_DELIVERY_FALLBACK || '').toLowerCase() !== 'false') {
        console.log('[INTERNAL_FALLBACK] Enabled for scheduled send');
        const domain = process.env.MAIL_DOMAIN || 'gozdedijital.xyz';
        for (const recipient of mail.to) {
          if (recipient.email.endsWith(`@${domain}`)) {
            console.log(`[INTERNAL_FALLBACK] Creating inbox copy for scheduled recipient ${recipient.email}`);
            const recipientUser = await User.findOne({ mailAddress: recipient.email });
            if (recipientUser) {
              console.log(`[INTERNAL_FALLBACK] Recipient user found: ${recipientUser._id}`);
              if (mailgunResult.messageId) {
                const dup = await Mail.findOne({ user: recipientUser._id, mailgunId: mailgunResult.messageId });
                if (dup) {
                  console.log('[INTERNAL_FALLBACK] Skipped creating scheduled inbox copy (already exists via webhook)');
                  continue;
                }
              }
              let inboxMessageId = `inbox-scheduled-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              let existingInboxMail = await Mail.findOne({ messageId: inboxMessageId });
              while (existingInboxMail) {
                inboxMessageId = `inbox-scheduled-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                existingInboxMail = await Mail.findOne({ messageId: inboxMessageId });
              }
              const inboxMailData = {
                from: mail.from,
                to: [{ email: recipient.email, name: recipient.name }],
                cc: mail.cc,
                bcc: mail.bcc,
                subject: mail.subject,
                content: mail.content,
                htmlContent: mail.htmlContent,
                folder: 'inbox',
                status: 'delivered',
                isRead: false,
                labels: mail.labels || [],
                categories: [], // Normal maillerin promotions kategorisine düşmemesi için categories boş
                attachments: mail.attachments,
                user: recipientUser._id,
                messageId: inboxMessageId,
                inReplyTo: mail.messageId,
                receivedAt: new Date(),
                mailgunId: mailgunResult.messageId
              };
              const inboxMail = new Mail(inboxMailData);
              await inboxMail.save();
              recipientUser.mails.push(inboxMail._id);
              await recipientUser.save();
              console.log(`[INTERNAL_FALLBACK] Inbox copy created (scheduled): ${inboxMail._id}`);
            }
          }
        }
      }
        } else {
          // Gönderim başarısız
          mail.status = 'failed';
          await mail.save();
          console.error(`Failed to send scheduled mail ${mail._id}:`, mailgunResult.error);
        }
      } catch (mailError) {
        console.error(`Error processing scheduled mail ${mail._id}:`, mailError);
        mail.status = 'failed';
        await mail.save();
      }
    }

    console.log(`Scheduled mail processing complete. Processed ${scheduledMails.length} mails.`);
    return scheduledMails.length;
  } catch (error) {
    console.error('Error in processScheduledMails:', error);
    return 0;
  }
};

// Add Reply to Mail
const addReplyToMail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content, replyTo } = req.body;
    const userId = req.user.userId;
    const files = req.files || [];

    console.log("addReplyToMail request body:", req.body);
    console.log("addReplyToMail files:", files);

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

    // Attachment'ları hazırla (sendMail ile aynı format)
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
      url: attachmentUrls[index] || null
    }));
    
    console.log("Final attachments:", attachments.map(att => ({ filename: att.filename, url: att.url })));

    // Cevabı orijinal maile ekle
    const replyData = {
      sender: `${user.name} ${user.surname}`,
      content: content,
      isFromMe: true
    };

    await originalMail.addReply(replyData);

    // Cevap için yeni bir mail objesi oluştur (gönderilen kutusuna düşmesi için)
    const replySubject = originalMail.subject.startsWith('Re:') ? originalMail.subject : `Re: ${originalMail.subject}`;
    
    // Unique messageId oluştur - duplicate hatası olmaması için
    let uniqueMessageId = `reply-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // MessageId'nin unique olduğundan emin ol
    let existingReply = await Mail.findOne({ messageId: uniqueMessageId });
    while (existingReply) {
      uniqueMessageId = `reply-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      existingReply = await Mail.findOne({ messageId: uniqueMessageId });
    }
    
    const replyMailData = {
      from: {
        email: user.mailAddress,
        name: `${user.name} ${user.surname}`
      },
      to: [{
        email: originalMail.from.email,
        name: originalMail.from.name
      }],
      cc: originalMail.cc || [],
      bcc: originalMail.bcc || [],
      subject: replySubject,
      content: content,
      htmlContent: content.replace(/\n/g, '<br>'),
      folder: 'sent',
      status: 'draft', // Draft olarak başla, gönderim başarılı olursa 'sent' olacak
      labels: originalMail.labels || [],
      categories: [], // Normal maillerin promotions kategorisine düşmemesi için categories boş
      attachments: attachments || [],
      user: userId,
      messageId: uniqueMessageId, // Unique messageId ekle
      inReplyTo: originalMail.messageId || originalMail._id.toString(),
      references: originalMail.references ? [...originalMail.references, originalMail.messageId || originalMail._id.toString()] : [originalMail.messageId || originalMail._id.toString()]
    };

    // Cevap mail'ini veritabanına kaydet
    const replyMail = new Mail(replyMailData);
    await replyMail.save();
    console.log("Reply mail saved to database with ID:", replyMail._id);

    // Mailgun ile cevabı gönder
    const recipientEmailClean = extractEmailAddress(originalMail.from.email);
    const mailgunData = {
      from: `${user.name} ${user.surname} <${user.mailAddress}>`,
      to: recipientEmailClean,
      subject: replySubject,
      text: content,
      html: content.replace(/\n/g, '<br>'),
      attachments: attachments || [],
      inReplyTo: originalMail.messageId || originalMail._id.toString(),
      references: originalMail.references ? [...originalMail.references, originalMail.messageId || originalMail._id.toString()] : [originalMail.messageId || originalMail._id.toString()]
    };

    console.log("Mailgun data for reply:", { ...mailgunData, attachments: mailgunData.attachments.map(att => ({ filename: att.filename, url: att.url })) });
    const mailgunResult = await mailgunService.sendMail(mailgunData);
    console.log("Mailgun result for reply:", mailgunResult);
    
    if (mailgunResult.success) {
      // Cevap mail durumunu güncelle
      replyMail.status = 'sent';
      replyMail.messageId = mailgunResult.messageId;
      replyMail.mailgunId = mailgunResult.messageId;
      replyMail.mailgunResponse = mailgunResult.response;
      await replyMail.save();
      console.log("Reply mail status updated to 'sent' for ID:", replyMail._id);

      // Kullanıcının mail listesine ekle
      user.mails.push(replyMail._id);
      await user.save();
      console.log("Reply mail added to user's mail list. User ID:", userId);

      // Optional internal delivery fallback for replies to same-domain recipients
      const domain = process.env.MAIL_DOMAIN || 'gozdedijital.xyz';
      const recipientEmail = extractEmailAddress(originalMail.from.email);
      // Reply fallback is disabled by default to avoid duplicate deliveries; enable with INTERNAL_REPLY_FALLBACK=true
      if ((process.env.INTERNAL_REPLY_FALLBACK || '').toLowerCase() === 'true' && recipientEmail.endsWith(`@${domain}`)) {
        console.log('[INTERNAL_FALLBACK] Enabled for reply (INTERNAL_REPLY_FALLBACK=true)');
        console.log(`[INTERNAL_FALLBACK] Creating inbox copy for reply to ${recipientEmail}`);
        const recipientUser = await User.findOne({ mailAddress: recipientEmail });
        if (recipientUser) {
          console.log(`[INTERNAL_FALLBACK] Recipient user found: ${recipientUser._id}`);
          if (mailgunResult.messageId) {
            const dup = await Mail.findOne({ user: recipientUser._id, mailgunId: mailgunResult.messageId });
            if (dup) {
              console.log('[INTERNAL_FALLBACK] Skipped creating reply inbox copy (already exists via webhook)');
              return res.status(StatusCodes.OK).json({
                success: true,
                message: "Cevap başarıyla gönderildi ve mail'e eklendi",
                mail: originalMail,
                replyMail: {
                  _id: replyMail._id,
                  subject: replyMail.subject,
                  to: replyMail.to,
                  status: replyMail.status,
                  folder: replyMail.folder,
                  sentAt: replyMail.sentAt
                },
                mailgunResult: mailgunResult
              });
            }
          }
          let inboxReplyMessageId = `inbox-reply-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          let existingInboxReply = await Mail.findOne({ messageId: inboxReplyMessageId });
          while (existingInboxReply) {
            inboxReplyMessageId = `inbox-reply-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            existingInboxReply = await Mail.findOne({ messageId: inboxReplyMessageId });
          }
          const inboxReplyData = {
            from: { email: user.mailAddress, name: `${user.name} ${user.surname}` },
            to: [{ email: recipientEmail, name: originalMail.from.name }],
            cc: originalMail.cc || [],
            bcc: originalMail.bcc || [],
            subject: replySubject,
            content: content,
            htmlContent: content.replace(/\n/g, '<br>'),
            folder: 'inbox',
            status: 'delivered',
            isRead: false,
            labels: originalMail.labels || [],
            categories: [], // Normal maillerin promotions kategorisine düşmemesi için categories boş
            attachments: attachments || [],
            user: recipientUser._id,
            messageId: inboxReplyMessageId,
            inReplyTo: originalMail.messageId || originalMail._id.toString(),
            references: originalMail.references ? [...originalMail.references, originalMail.messageId || originalMail._id.toString()] : [originalMail.messageId || originalMail._id.toString()],
            receivedAt: new Date(),
            mailgunId: mailgunResult.messageId
          };
          const inboxReply = new Mail(inboxReplyData);
          await inboxReply.save();
          recipientUser.mails.push(inboxReply._id);
          await recipientUser.save();
          console.log(`[INTERNAL_FALLBACK] Inbox copy created (reply): ${inboxReply._id}`);
          // Do not also mutate recipient's original mail conversation to avoid double entries in inbox
        }
      }

      res.status(StatusCodes.OK).json({
        success: true,
        message: "Cevap başarıyla gönderildi ve mail'e eklendi",
        mail: originalMail,
        replyMail: {
          _id: replyMail._id,
          subject: replyMail.subject,
          to: replyMail.to,
          status: replyMail.status,
          folder: replyMail.folder,
          sentAt: replyMail.sentAt
        },
        mailgunResult: mailgunResult
      });
    } else {
      // Gönderim başarısız
      replyMail.status = 'failed';
      await replyMail.save();

      res.status(StatusCodes.OK).json({
        success: true,
        message: "Cevap mail'e eklendi ancak gönderimde hata oluştu",
        mail: originalMail,
        replyMail: {
          _id: replyMail._id,
          subject: replyMail.subject,
          to: replyMail.to,
          status: replyMail.status,
          folder: replyMail.folder
        },
        mailgunError: mailgunResult.error
      });
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendMail,
  saveDraft,
  getDrafts,
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
  getStarredMails,
  getMailStats,
  markMailAsImportant,
  markMailAsStarred,
  snoozeMail,
  addReplyToMail,
  checkMailAddress,
  setupMailAddress,
  testMailgunConfig,
  checkMailAuthentication,
  createMailbox,
  listMailboxes,
  testWebhook,
  handleMailgunWebhook,
  cleanupTrashMails,
  manualCleanupTrash,
  fixGmailAttachmentUrls,
  scheduleMailForLater,
  getScheduledMails,
  cancelScheduledMail,
  updateScheduledMail,
  processScheduledMails
};