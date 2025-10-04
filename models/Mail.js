const mongoose = require("mongoose");

const MailSchema = new mongoose.Schema({
  // Gönderen bilgileri
  from: {
    email: { type: String, required: true },
    name: { type: String, required: true }
  },
  
  // Alıcı bilgileri
  to: [{
    email: { type: String, required: true },
    name: { type: String, required: true }
  }],
  
  // Kopya alanlar
  cc: [{
    email: { type: String },
    name: { type: String }
  }],
  
  // Gizli kopya
  bcc: [{
    email: { type: String },
    name: { type: String }
  }],
  
  // Mail içeriği
  subject: { type: String, required: true },
  content: { type: String, required: true },
  htmlContent: { type: String },
  
  // Mail durumu
  status: {
    type: String,
    enum: ['draft', 'sent', 'delivered', 'failed', 'bounced'],
    default: 'draft'
  },
  
  // Klasör bilgisi
  folder: {
    type: String,
    enum: ['inbox', 'sent', 'drafts', 'spam', 'trash', 'archive'],
    default: 'inbox'
  },
  
  // Okunma durumu
  isRead: { type: Boolean, default: false },
  isImportant: { type: Boolean, default: false },
  isStarred: { type: Boolean, default: false },
  
  // Ekler
  attachments: [{
    filename: { type: String },
    originalName: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    url: { type: String }
  }],
  
  // Etiketler (kategoriler)
  labels: [{
    type: String,
    enum: ['social', 'updates', 'forums', 'shopping', 'promotions', 'work', 'personal', 'important', 'meeting']
  }],
  
  // Kategoriler (etiketlerle aynı ama ayrı tutuyoruz)
  categories: [{
    type: String,
    enum: ['social', 'updates', 'forums', 'shopping', 'promotions']
  }],
  
  // Mail ID'leri
  messageId: { type: String, unique: true },
  inReplyTo: { type: String },
  references: [{ type: String }],
  
  // Zaman damgaları
  sentAt: { type: Date },
  receivedAt: { type: Date },
  readAt: { type: Date },
  snoozeUntil: { type: Date },
  
  // Kullanıcı referansı
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Mailgun bilgileri
  mailgunId: { type: String },
  mailgunResponse: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

// Index'ler
MailSchema.index({ user: 1, folder: 1 });
MailSchema.index({ user: 1, isRead: 1 });
MailSchema.index({ user: 1, createdAt: -1 });
MailSchema.index({ 'to.email': 1 });
MailSchema.index({ 'from.email': 1 });
MailSchema.index({ subject: 'text', content: 'text' });

// Pre-save middleware
MailSchema.pre('save', function(next) {
  if (this.status === 'sent' && !this.sentAt) {
    this.sentAt = new Date();
  }
  if (this.isRead && !this.readAt) {
    this.readAt = new Date();
  }
  next();
});

// Metodlar
MailSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

MailSchema.methods.markAsUnread = function() {
  this.isRead = false;
  this.readAt = undefined;
  return this.save();
};

MailSchema.methods.moveToFolder = function(folder) {
  this.folder = folder;
  return this.save();
};

MailSchema.methods.addLabel = function(label) {
  if (!this.labels.includes(label)) {
    this.labels.push(label);
  }
  return this.save();
};

MailSchema.methods.removeLabel = function(label) {
  this.labels = this.labels.filter(l => l !== label);
  return this.save();
};

MailSchema.methods.addCategory = function(category) {
  if (!this.categories.includes(category)) {
    this.categories.push(category);
  }
  // Aynı zamanda labels'a da ekle
  if (!this.labels.includes(category)) {
    this.labels.push(category);
  }
  return this.save();
};

MailSchema.methods.removeCategory = function(category) {
  this.categories = this.categories.filter(c => c !== category);
  // Labels'dan da çıkar
  this.labels = this.labels.filter(l => l !== category);
  return this.save();
};

const Mail = mongoose.model("Mail", MailSchema);

module.exports = Mail;
