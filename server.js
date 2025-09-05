require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');

// Import Firebase configuration
const { db } = require('./config/firebase');
const ensureInit = require('./initFirestore');

// Import routes
const wishesRouter = require('./routes/wishes');
const mediaRouter = require('./routes/media');
const remindersRouter = require('./routes/reminders');
const eventsRouter = require("./routes/events");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS configuration
app.use(cors({
  origin: '*',
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "font-src 'self' data:;");
  next();
});

// Environment variables for collection management
const DEFAULT_COLLECTION = process.env.DEFAULT_COLLECTION || 'wedding-data';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Wedding Backend API is running',
    firebase: db ? 'connected' : 'disconnected',
    project: process.env.PROJECT_ID || 'safipraneeth-effbc',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Firebase status endpoint
app.get('/firebase-status', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ 
        status: 'error', 
        message: 'Firebase not initialized' 
      });
    }
    
    // Test Firestore connection
    await db.collection('test').limit(1).get();
    res.json({
      status: 'connected',
      message: 'Firebase Firestore is accessible',
      project: process.env.PROJECT_ID || 'safipraneeth-effbc'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Firebase connection failed',
      error: error.message
    });
  }
});

// Endpoint to list docs from default collection
app.get('/docs', async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Firebase not connected' });
  }
  
  try {
    const snapshot = await db.collection(DEFAULT_COLLECTION).limit(50).get();
    const docs = [];
    snapshot.forEach(doc => {
      docs.push({ id: doc.id, ...doc.data() });
    });
    res.json({ docs, count: docs.length });
  } catch (error) {
    console.error('Error fetching docs:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Routes
app.use('/api/wishes', wishesRouter);
app.use('/api/media', mediaRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/events', eventsRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler - fixed the wildcard route
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

// Ensure default collection exists and start server
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Wedding Backend API running on port ${PORT}`);
  console.log(`📱 Health check: http://localhost:${PORT}/health`);
  console.log(`🔥 Firebase status: http://localhost:${PORT}/firebase-status`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  if (db) {
    console.log(`✅ Firebase: Connected and ready`);
    
    try {
      await ensureInit(db, DEFAULT_COLLECTION);
      console.log('Firestore collections verified and ready.');
    } catch (err) {
      console.error('Error during Firestore verification:', err);
    }
  } else {
    console.log(`⚠️  Firebase: Disconnected - follow setup guide`);
  }
});

module.exports = app;
