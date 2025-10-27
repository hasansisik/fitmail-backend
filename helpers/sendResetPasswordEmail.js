const sendEmail = require('./sendEmail');

const sendResetPasswordEmail = async ({ name, email, passwordToken }) => {
    const message = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Şifre Sıfırlama Talebi</h2>
            <p>Merhaba ${name},</p>
            <p>Fitmail hesabınız için şifre sıfırlama talebinde bulundunuz.</p>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
                <p style="margin: 0; font-size: 14px; color: #666;">Şifre Sıfırlama Kodunuz:</p>
                <p style="font-size: 32px; font-weight: bold; color: #333; margin: 10px 0; letter-spacing: 5px;">${passwordToken}</p>
                <p style="margin: 0; font-size: 12px; color: #999;">Bu kod 10 dakika geçerlidir</p>
            </div>
            <p style="color: #666; font-size: 14px;">Bu talebi siz yapmadıysanız, bu e-postayı görmezden gelebilirsiniz.</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
                Güvenlik nedeniyle, bu kodu kimseyle paylaşmayın.
            </p>
        </div>
    `;

    return sendEmail({
        to: email,
        subject: 'Fitmail - Şifre Sıfırlama Kodu',
        html: message,
    });
};

module.exports = sendResetPasswordEmail;