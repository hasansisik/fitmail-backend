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

//midlleware
const notFoundMiddleware = require('./middleware/not-found')
const erorHandlerMiddleware = require('./middleware/eror-handler')

app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://fitmail.vercel.app',
        'https://fitmail-nextjs.vercel.app',
        'https://fitmail.com',
        'https://www.fitmail.com',
    ],
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
    origin: [
        'http://localhost:3000',
        'https://fitmail.vercel.app',
        'https://fitmail-nextjs.vercel.app',
        'https://fitmail.com',
        'https://www.fitmail.com',
    ],
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

app.use(notFoundMiddleware);
app.use(erorHandlerMiddleware);

const port = process.env.PORT || 5003

const start = async () => {
    try {
        await connectDB(process.env.MONGO_URL)
        app.listen(port,
            console.log(`MongoDb Connection Successful,App started on port ${port} : ${process.env.NODE_ENV}`),
        );
    } catch (error) {
        console.log(error);
    }
};

start();