import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import airdropRoutes from './routes/airdrops';
import walletRoutes from './routes/wallet';
import airdropSyncService from './services/airdropSyncService';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '5000');
const isProduction = process.env.NODE_ENV === 'production';

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Middleware
app.use(helmet());
app.use(limiter);

// CORS configuration for production
const corsOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/airdrops', airdropRoutes);
app.use('/api/wallet', walletRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    realAirdropsEnabled: true
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize real airdrop services
const initializeRealAirdrops = async () => {
  try {
    console.log('🚀 Initializing real airdrop services...');
    
    // Start automatic monitoring and sync
    await airdropSyncService.startAutomaticMonitoring();
    
    // Check if we need initial sync
    const { VerifiedAirdrop } = await import('./models/VerifiedAirdrop');
    const existingAirdrops = await VerifiedAirdrop.countDocuments();
    
    if (existingAirdrops === 0) {
      console.log('📥 No airdrops found, performing initial sync...');
      await airdropSyncService.syncRealAirdrops();
    }
    
    console.log('✅ Real airdrop services initialized');
  } catch (error) {
    console.error('❌ Error initializing real airdrop services:', error);
    // Don't exit the process, just log the error
  }
};

// Database connection with real airdrops initialization
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/airdrop-finder')
  .then(async () => {
    if (!isProduction) {
      console.log('✅ Connected to MongoDB');
    }
    
    // Initialize real airdrops after DB connection
    await initializeRealAirdrops();
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  mongoose.connection.close().then(() => {
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  }).catch((err: any) => {
    console.error('Error closing MongoDB connection:', err);
    process.exit(1);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!isProduction) {
    console.log(`📊 Environment: ${process.env.NODE_ENV}`);
    console.log(`🎯 Real Airdrops: ENABLED`);
    console.log(`🌐 CORS Origins: ${corsOrigins.join(', ')}`);
  }
});