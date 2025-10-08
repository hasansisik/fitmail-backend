const Premium = require('../models/Premium');
const User = require('../models/User');

// Tüm premium planları getir
const getAllPremiums = async (req, res) => {
  try {
    const premiums = await Premium.find()
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: premiums,
      count: premiums.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Premium planlar getirilirken hata oluştu',
      error: error.message
    });
  }
};

// Tek premium plan getir
const getPremiumById = async (req, res) => {
  try {
    const premium = await Premium.findById(req.params.id)
      .populate('createdBy', 'name email');
    
    if (!premium) {
      return res.status(404).json({
        success: false,
        message: 'Premium plan bulunamadı'
      });
    }
    
    res.status(200).json({
      success: true,
      data: premium
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Premium plan getirilirken hata oluştu',
      error: error.message
    });
  }
};

// Yeni premium plan oluştur
const createPremium = async (req, res) => {
  try {
    const { name, price, description, features, duration } = req.body;
    console.log(req.user);
    
    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir'
      });
    }
    
    // Benzersiz kod oluştur
    const code = await Premium.generateUniqueCode();
    
    const premiumData = {
      name,
      price,
      code,
      description,
      features,
      duration,
      createdBy: req.user.userId
    };
    
    const premium = new Premium(premiumData);
    await premium.save();
    
    await premium.populate('createdBy', 'name email');
    
    res.status(201).json({
      success: true,
      message: 'Premium plan başarıyla oluşturuldu',
      data: premium
    });
  } catch (error) {

    console.log(error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Bu kod zaten kullanılıyor'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Premium plan oluşturulurken hata oluştu',
      error: error.message
    });
  }
};

// Premium plan güncelle
const updatePremium = async (req, res) => {
  try {
    const { name, price, description, features, duration, isActive } = req.body;
    
    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir'
      });
    }
    
    const premium = await Premium.findById(req.params.id);
    
    if (!premium) {
      return res.status(404).json({
        success: false,
        message: 'Premium plan bulunamadı'
      });
    }
    
    // Güncelleme verilerini hazırla
    const updateData = {};
    if (name) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (description !== undefined) updateData.description = description;
    if (features) updateData.features = features;
    if (duration !== undefined) updateData.duration = duration;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    const updatedPremium = await Premium.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');
    
    res.status(200).json({
      success: true,
      message: 'Premium plan başarıyla güncellendi',
      data: updatedPremium
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Premium plan güncellenirken hata oluştu',
      error: error.message
    });
  }
};

// Premium plan sil
const deletePremium = async (req, res) => {
  try {
    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir'
      });
    }
    
    const premium = await Premium.findById(req.params.id);
    
    if (!premium) {
      return res.status(404).json({
        success: false,
        message: 'Premium plan bulunamadı'
      });
    }
    
    await Premium.findByIdAndDelete(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Premium plan başarıyla silindi'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Premium plan silinirken hata oluştu',
      error: error.message
    });
  }
};

// Premium plan aktif/pasif yap
const togglePremiumStatus = async (req, res) => {
  try {
    // Admin kontrolü
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bu işlem için admin yetkisi gereklidir'
      });
    }
    
    const premium = await Premium.findById(req.params.id);
    
    if (!premium) {
      return res.status(404).json({
        success: false,
        message: 'Premium plan bulunamadı'
      });
    }
    
    premium.isActive = !premium.isActive;
    await premium.save();
    
    await premium.populate('createdBy', 'name email');
    
    res.status(200).json({
      success: true,
      message: `Premium plan ${premium.isActive ? 'aktif' : 'pasif'} edildi`,
      data: premium
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Premium plan durumu değiştirilirken hata oluştu',
      error: error.message
    });
  }
};

// Kod ile premium plan getir
const getPremiumByCode = async (req, res) => {
  try {
    const { code } = req.params;
    
    const premium = await Premium.findOne({ 
      code: code.toUpperCase(),
      isActive: true 
    }).populate('createdBy', 'name email');
    
    if (!premium) {
      return res.status(404).json({
        success: false,
        message: 'Geçersiz veya pasif premium kodu'
      });
    }
    
    res.status(200).json({
      success: true,
      data: premium
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Premium plan getirilirken hata oluştu',
      error: error.message
    });
  }
};

module.exports = {
  getAllPremiums,
  getPremiumById,
  createPremium,
  updatePremium,
  deletePremium,
  togglePremiumStatus,
  getPremiumByCode
};
