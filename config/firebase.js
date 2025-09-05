const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

let db, storage, bucket, firebaseConnected = false;

try {
  const serviceAccount = require('../serviceAccountKey.json'); // Correct path
  
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.PROJECT_ID,
      storageBucket: process.env.STORAGE_BUCKET, // Ensure this is set
    });
  }

  db = admin.firestore();
  db.settings({ 
    databaseId: process.env.FIREBASE_DATABASE_ID || 'database',
  });
  
  try {
    storage = admin.storage();
    bucket = storage.bucket(process.env.STORAGE_BUCKET);
    console.log('🗄️ Storage Bucket:', process.env.STORAGE_BUCKET);
  } catch (storageError) {
    console.warn('⚠️ Firebase Storage not available:', storageError.message);
    storage = null;
    bucket = null;
  }

  firebaseConnected = true;
  console.log('🔥 Firebase initialized successfully');
  console.log('📊 Project ID:', process.env.PROJECT_ID);

} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  firebaseConnected = false;
}

module.exports = {
  admin,
  db,
  storage,
  bucket,
  firebaseConnected
};
