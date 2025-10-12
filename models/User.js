const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const AddressSchema = new mongoose.Schema({
  street: { type: String, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  postalCode: { type: String, trim: true },
  country: { type: String, trim: true, default: "Turkey" },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const Address = mongoose.model("Address", AddressSchema);

const AuthSchema = new mongoose.Schema({
  password: { type: String, required: true, select: false },
  verificationCode: { type: Number},
  passwordToken: { type: String, select: false },
  passwordTokenExpirationDate: { type: Date, select: false },
  passwordChangedAt: { type: Date, default: Date.now },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

// Şifreyi hashleme işlemi
AuthSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Şifre karşılaştırma metodu
AuthSchema.methods.comparePassword = async function (candidatePassword) {
  const isMatch = await bcrypt.compare(candidatePassword, this.password);
  return isMatch;
};

const Auth = mongoose.model("Auth", AuthSchema);

const ProfileSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    validate: {
      validator: function (v) {
        if (!v || v.trim() === '') return true; // Allow empty values
        // More flexible phone number validation
        return /^(\+90|0)?[5][0-9]{9}$/.test(v.replace(/\s/g, ''));
      },
      message: (props) => `${props.value} geçerli bir telefon numarası değil!`,
    },
  },
  picture: {
    type: String,
    default: "https://res.cloudinary.com/da2qwsrbv/image/upload/v1759932330/F_punfds.png",
  },
  bio: {
    type: String,
    maxlength: [500, 'Biyografi 500 karakterden uzun olamaz']
  },
  skills: [{
    type: String,
    trim: true
  }],
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const Profile = mongoose.model("Profile", ProfileSchema);

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    surname: { type: String, required: true, trim: true},
    username: { type: String, sparse: true},
    email: {
      type: String,
      required: [true, "Lütfen e-posta adresinizi girin"],
      unique: true,
      lowercase: true,
    },
    birthDate: { type: Date },
    age: { 
      type: Number,
      min: [13, 'Yaş 13\'ten az olamaz'],
      max: [120, 'Yaş 120\'den fazla olamaz']
    },
    gender: { 
      type: String, 
      enum: ['male', 'female', 'other'],
      lowercase: true 
    },
    weight: { 
      type: Number,
      min: [20, 'Kilo 20 kg\'dan az olamaz'],
      max: [300, 'Kilo 300 kg\'dan fazla olamaz']
    },
    height: { 
      type: Number,
      min: [100, 'Boy 100 cm\'den az olamaz'],
      max: [250, 'Boy 250 cm\'den fazla olamaz']
    },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    isVerified: { type: Boolean, default: false },
    address: { type: mongoose.Schema.Types.ObjectId, ref: 'Address' },
    auth: { type: mongoose.Schema.Types.ObjectId, ref: 'Auth' }, 
    profile: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile' },
    conversations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' }],
    expoPushToken: { type: String },
    courseTrial: { type: String },
    // Mail sistemi için
    mailAddress: { 
      type: String, 
      unique: false, // email ile aynı olacağı için unique kaldırıldı
      lowercase: true,
      validate: {
        validator: function(v) {
          if (!v) return true; // Optional field
          return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
        },
        message: 'Geçerli bir mail adresi giriniz'
      }
    },
    recoveryEmail: {
      type: String,
      lowercase: true,
      validate: {
        validator: function(v) {
          if (!v) return true; // Optional field
          return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v);
        },
        message: 'Geçerli bir kurtarıcı e-posta adresi giriniz'
      }
    },
    mails: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Mail' }],
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive'],
        message: '{VALUE} geçerli bir durum değil'
      },
      default: 'inactive'
    },
    theme: {
      type: String,
      enum: {
        values: ['light', 'dark'],
        message: '{VALUE} geçerli bir tema değil'
      },
      default: 'light'
    },
    settings: {
      language: {
        type: String,
        enum: ['tr', 'en', 'de', 'fr'],
        default: 'tr'
      },
      timezone: {
        type: String,
        default: 'Europe/Istanbul'
      },
      dateFormat: {
        type: String,
        enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
        default: 'DD/MM/YYYY'
      },
      timeFormat: {
        type: String,
        enum: ['12', '24'],
        default: '24'
      }
    }
  },
  { timestamps: true }
);

// Pre-delete middleware for findOneAndDelete
UserSchema.pre('findOneAndDelete', async function(next) {
  next();
});

// Pre-delete middleware for findByIdAndDelete
UserSchema.pre('deleteOne', async function(next) {
  next();
});

const User = mongoose.model("User", UserSchema);

module.exports = { User, Address, Auth, Profile };
