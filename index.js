require('dotenv').config();
require('express-async-errors');
//express
const express = require('express');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const cors = require('cors');
const app = express();

// rest of the packages
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

//database
const connectDB = require('./config/connectDB');

//routers
const authRouter = require('./routers/auth');
const mailRouter = require('./routers/mail');
const premiumRouter = require('./routers/premium');

//controllers
const { cleanupTrashMails } = require('./controllers/mail');

//midlleware
const notFoundMiddleware = require('./middleware/not-found')
const erorHandlerMiddleware = require('./middleware/eror-handler')

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:3000',
            'http://account.localhost:3000',
            'http://panel.localhost:3000',
            'https://fitmail-nextjs.vercel.app',
            'https://fitmail.vercel.app',
            'https://fitmail-nextjs.vercel.app',
            'https://gozdedijital.vercel.app',
            'https://gozdedijital-nextjs.vercel.app',
            'https://fitmail.com',
            'https://www.fitmail.com',
            'https://account.fitmail.com',
            'https://panel.fitmail.com',
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'Accept', 
        'Cookie',
        'Cache-Control',
        'Pragma',
        'X-Requested-With'
    ],
    exposedHeaders: ['Content-Type', 'Authorization']
}));

// For preflight OPTIONS requests
app.options('*', cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:3000',
            'http://account.localhost:3000',
            'http://panel.localhost:3000',
            'https://fitmail-nextjs.vercel.app',
            'https://fitmail.vercel.app',
            'https://fitmail-nextjs.vercel.app',
            'https://gozdedijital.vercel.app',
            'https://gozdedijital-nextjs.vercel.app',
            'https://fitmail.com',
            'https://www.fitmail.com',
            'https://account.fitmail.com',
            'https://panel.fitmail.com',
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'Accept', 
        'Cookie',
        'Cache-Control',
        'Pragma',
        'X-Requested-With'
    ]
}));

// Add headers to prevent CORS caching issues
app.use((req, res, next) => {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    next();
});

app.use(helmet());
app.use(mongoSanitize());

//app
app.use(morgan('tiny'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(process.env.JWT_SECRET_KEY));

app.use(express.static('./public'));

//routes
app.use('/v1/auth', authRouter);
app.use('/v1/mail', mailRouter);
app.use('/v1/premium', premiumRouter);

app.use(notFoundMiddleware);
app.use(erorHandlerMiddleware);

const port = process.env.PORT || 5003

// Planlı mailleri kontrol etmek için cron job
const { processScheduledMails } = require('./controllers/mail');

// Her dakika planlı mailleri kontrol et
setInterval(async () => {
  try {
    await processScheduledMails();
  } catch (error) {
    console.error('Error in scheduled mail processing:', error);
  }
}, 60000); // 60 saniye = 1 dakika

const start = async () => {
    try {
        await connectDB(process.env.MONGO_URL)
        app.listen(port,
            console.log(`MongoDb Connection Successful,App started on port ${port} : ${process.env.NODE_ENV}`),
        );
        
        // Otomatik çöp kutusu temizleme - her gün saat 02:00'da çalışır
        setInterval(async () => {
            try {
                console.log('Running automatic trash cleanup...');
                const deletedCount = await cleanupTrashMails();
                if (deletedCount > 0) {
                    console.log(`Automatic cleanup completed: ${deletedCount} mails deleted`);
                }
            } catch (error) {
                console.error('Automatic cleanup failed:', error);
            }
        }, 24 * 60 * 60 * 1000); // 24 saat
        
        // İlk temizleme işlemini hemen çalıştır (opsiyonel)
        setTimeout(async () => {
            try {
                console.log('Running initial trash cleanup...');
                await cleanupTrashMails();
            } catch (error) {
                console.error('Initial cleanup failed:', error);
            }
        }, 5000); // 5 saniye sonra
        
    } catch (error) {
        console.log(error);
    }
};

start();