const mongoose = require("mongoose");

const PremiumSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Plan adı gereklidir"],
    trim: true,
    maxlength: [50, "Plan adı 50 karakterden fazla olamaz"]
  },
  price: {
    type: Number,
    required: [true, "Fiyat gereklidir"],
    min: [0, "Fiyat 0'dan küçük olamaz"]
  },
  code: {
    type: String,
    required: [true, "Kod gereklidir"],
    unique: true,
    uppercase: true,
    length: [5, "Kod tam 5 karakter olmalıdır"]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, "Açıklama 200 karakterden fazla olamaz"]
  },
  features: [{
    type: String,
    trim: true
  }],
  duration: {
    type: Number,
    default: 30, // gün cinsinden
    min: [1, "Süre en az 1 gün olmalıdır"]
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Kod oluşturma middleware
PremiumSchema.pre('save', function(next) {
  if (this.isNew && !this.code) {
    this.code = generatePremiumCode();
  }
  next();
});

// 5 haneli kod üretici
function generatePremiumCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Statik metodlar
PremiumSchema.statics.generateUniqueCode = async function() {
  let code;
  let isUnique = false;
  
  while (!isUnique) {
    code = generatePremiumCode();
    const existing = await this.findOne({ code });
    if (!existing) {
      isUnique = true;
    }
  }
  
  return code;
};

// Instance metodlar
PremiumSchema.methods.activate = function() {
  this.isActive = true;
  return this.save();
};

PremiumSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};


module.exports = mongoose.model("Premium", PremiumSchema);
