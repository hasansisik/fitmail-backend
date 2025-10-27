const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

const CLOUD_NAME = 'da2qwsrbv';
const API_KEY = '712369776222516';
const API_SECRET = '3uw0opJfkdYDp-XQsXclVIcbbKQ';

function generateSignature(params) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  const stringToSign = sortedParams + API_SECRET;
  return crypto.createHash('sha1').update(stringToSign).digest('hex');
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
    
    // Dosya türüne göre upload endpoint ve resource_type belirle
    let uploadEndpoint = 'image/upload';
    let resourceType = 'image';
    
    if (mimetype.startsWith('image/')) {
      uploadEndpoint = 'image/upload';
      resourceType = 'image';
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
      resourceType = 'raw';
    } else {
      // Diğer dosyalar için raw upload kullan
      uploadEndpoint = 'raw/upload';
      resourceType = 'raw';
    }

    // İmza için parametreler
    const params = {
      timestamp: timestamp,
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true
    };
    
    // İmza oluştur
    const signature = generateSignature(params);

    // FormData oluştur
    const formData = new FormData();
    formData.append('file', fileBuffer, { filename: filename });
    formData.append('api_key', API_KEY);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('resource_type', resourceType);
    formData.append('use_filename', 'true');
    formData.append('unique_filename', 'true');

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

