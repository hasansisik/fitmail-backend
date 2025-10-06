const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

const CLOUD_NAME = 'da2qwsrbv';
const API_KEY = '712369776222516';
const API_SECRET = '3uw0opJfkdYDp-XQsXclVIcbbKQ';

function generateSignature(timestamp) {
  const str = `timestamp=${timestamp}${API_SECRET}`;
  return crypto.createHash('sha1').update(str).digest('hex');
}

/**
 * Upload file buffer to Cloudinary
 * @param {Buffer} fileBuffer - File buffer from multer
 * @param {string} filename - Original filename
 * @param {string} mimetype - File mimetype
 * @returns {Promise<string>} Cloudinary secure URL
 */
async function uploadFileToCloudinary(fileBuffer, filename, mimetype) {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = generateSignature(timestamp);

    // Dosya türüne göre upload endpoint'i belirle
    let uploadEndpoint = 'image/upload';
    
    if (mimetype.startsWith('image/')) {
      uploadEndpoint = 'image/upload';
    } else if (
      mimetype.includes('pdf') || 
      mimetype.includes('document') || 
      mimetype.includes('text') ||
      mimetype.includes('word') ||
      mimetype.includes('excel') ||
      mimetype.includes('powerpoint') ||
      mimetype.includes('zip') ||
      mimetype.includes('rar')
    ) {
      uploadEndpoint = 'raw/upload';
    } else {
      // Diğer dosyalar için raw upload kullan
      uploadEndpoint = 'raw/upload';
    }

    // FormData oluştur
    const formData = new FormData();
    formData.append('file', fileBuffer, { filename: filename });
    formData.append('api_key', API_KEY);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);

    // Cloudinary'ye yükle
    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${uploadEndpoint}`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    console.log(`✅ File uploaded to Cloudinary: ${filename} -> ${response.data.secure_url}`);
    return response.data.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error.message);
    throw error;
  }
}

module.exports = { uploadFileToCloudinary };

