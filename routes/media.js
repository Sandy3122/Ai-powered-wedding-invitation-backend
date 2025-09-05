const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { db, bucket } = require('../config/firebase');

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images and videos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'), false);
    }
  }
});

// Upload media to Firebase Storage and save metadata to Firestore
router.post('/upload', upload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { title, type, date } = req.body;
    const file = req.file;
    const fileId = uuidv4();
    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${fileId}.${fileExtension}`;
    
    // Determine file type
    const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'photo';
    
    // Upload to Firebase Storage
    const fileUpload = bucket.file(`media/${fileName}`);
    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    // Process image if it's a photo (resize and optimize)
    let processedBuffer = file.buffer;
    if (mediaType === 'photo') {
      try {
        processedBuffer = await sharp(file.buffer)
          .resize(1200, 1200, { 
            fit: 'inside',
            withoutEnlargement: true 
          })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch (error) {
        console.log('Image processing failed, using original:', error.message);
        processedBuffer = file.buffer;
      }
    }

    // Upload the file
    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(processedBuffer);
    });

    // Get download URL
    const [url] = await fileUpload.getSignedUrl({
      action: 'read',
      expires: '03-01-2500' // Far future date
    });

    // Create thumbnail for photos
    let thumbnailUrl = url;
    if (mediaType === 'photo') {
      try {
        const thumbnailBuffer = await sharp(file.buffer)
          .resize(300, 300, { 
            fit: 'cover',
            position: 'center'
          })
          .jpeg({ quality: 80 })
          .toBuffer();

        const thumbnailUpload = bucket.file(`thumbnails/${fileId}.jpg`);
        const thumbnailStream = thumbnailUpload.createWriteStream({
          metadata: {
            contentType: 'image/jpeg',
            metadata: {
              originalName: file.originalname,
              uploadedAt: new Date().toISOString()
            }
          }
        });

        await new Promise((resolve, reject) => {
          thumbnailStream.on('error', reject);
          thumbnailStream.on('finish', resolve);
          thumbnailStream.end(thumbnailBuffer);
        });

        const [thumbnailUrlResult] = await thumbnailUpload.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });
        thumbnailUrl = thumbnailUrlResult;
      } catch (error) {
        console.log('Thumbnail creation failed:', error.message);
      }
    }

    // Save metadata to Firestore
    const mediaData = {
      id: fileId,
      type: mediaType,
      url: url,
      thumbnail: thumbnailUrl,
      title: title || `Untitled ${mediaType}`,
      date: date || new Date().toISOString(),
      likes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      originalName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype
    };

    await db.collection('media').doc(fileId).set(mediaData);

    res.status(201).json({
      success: true,
      message: 'Media uploaded successfully',
      data: mediaData
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload media',
      error: error.message
    });
  }
});

// Get all media
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('media')
      .orderBy('createdAt', 'desc')
      .get();

    const media = [];
    snapshot.forEach(doc => {
      media.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: media
    });
  } catch (error) {
    console.error('Get media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch media',
      error: error.message
    });
  }
});

// Get single media item
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('media').doc(req.params.id).get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: doc.id,
        ...doc.data()
      }
    });
  } catch (error) {
    console.error('Get media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch media',
      error: error.message
    });
  }
});

// Update media
router.put('/:id', async (req, res) => {
  try {
    const { title, date } = req.body;
    const updateData = {
      updatedAt: new Date()
    };

    if (title) updateData.title = title;
    if (date) updateData.date = date;

    await db.collection('media').doc(req.params.id).update(updateData);

    const doc = await db.collection('media').doc(req.params.id).get();
    
    res.json({
      success: true,
      message: 'Media updated successfully',
      data: {
        id: doc.id,
        ...doc.data()
      }
    });
  } catch (error) {
    console.error('Update media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update media',
      error: error.message
    });
  }
});

// Delete media
router.delete('/:id', async (req, res) => {
  try {
    const doc = await db.collection('media').doc(req.params.id).get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }

    const mediaData = doc.data();
    
    // Delete from Firebase Storage
    try {
      const fileName = mediaData.url.split('/').pop().split('?')[0];
      const filePath = `media/${fileName}`;
      await bucket.file(filePath).delete();
      
      // Delete thumbnail if it exists
      if (mediaData.thumbnail && mediaData.thumbnail !== mediaData.url) {
        const thumbnailName = mediaData.thumbnail.split('/').pop().split('?')[0];
        const thumbnailPath = `thumbnails/${thumbnailName}`;
        await bucket.file(thumbnailPath).delete();
      }
    } catch (storageError) {
      console.log('Storage deletion error (continuing):', storageError.message);
    }

    // Delete from Firestore
    await db.collection('media').doc(req.params.id).delete();

    res.json({
      success: true,
      message: 'Media deleted successfully'
    });
  } catch (error) {
    console.error('Delete media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete media',
      error: error.message
    });
  }
});

// Like/Unlike media
router.post('/:id/like', async (req, res) => {
  try {
    const { action } = req.body; // 'like' or 'unlike'
    const mediaId = req.params.id;
    
    const doc = await db.collection('media').doc(mediaId).get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Media not found'
      });
    }

    const currentLikes = doc.data().likes || 0;
    const newLikes = action === 'like' ? currentLikes + 1 : Math.max(0, currentLikes - 1);

    await db.collection('media').doc(mediaId).update({
      likes: newLikes,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: `Media ${action}d successfully`,
      data: {
        likes: newLikes
      }
    });
  } catch (error) {
    console.error('Like media error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like/unlike media',
      error: error.message
    });
  }
});

module.exports = router;
