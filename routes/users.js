const express = require('express');
const router = express.Router();
const User = require('../models/user')
const Message = require('../models/message');

// Auth middleware
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new Error('No token');
    
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Get contacts
router.get('/contacts', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('contacts', 'username email online inviteCode');
    res.json(user.contacts || []);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's invite code
router.get('/invite-code', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('inviteCode');
    res.json({ inviteCode: user.inviteCode });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get messages with a contact - CRITICAL: Must return ALL fields including file data
router.get('/messages/:contactId', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.userId, receiver: req.params.contactId },
        { sender: req.params.contactId, receiver: req.userId }
      ]
    })
    .sort({ timestamp: 1 })
    .lean(); // Use lean() for better performance with large file data
    
    // Return ALL message data including files
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add contact
router.post('/add-contact', auth, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    
    const contact = await User.findOne({ inviteCode });
    if (!contact) {
      return res.status(404).json({ message: 'Invalid invite code' });
    }
    
    if (contact._id.toString() === req.userId) {
      return res.status(400).json({ message: 'Cannot add yourself' });
    }
    
    const user = await User.findById(req.userId);
    
    // Check if already added
    if (user.contacts.includes(contact._id)) {
      return res.status(400).json({ message: 'Already in contacts' });
    }
    
    // Add to both users
    user.contacts.push(contact._id);
    await user.save();
    
    contact.contacts.push(user._id);
    await contact.save();
    
    res.json({ message: 'Contact added', contact });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete contact
router.delete('/delete-contact/:contactId', auth, async (req, res) => {
  try {
    const { contactId } = req.params;
    
    // Remove from both users
    await User.findByIdAndUpdate(req.userId, {
      $pull: { contacts: contactId }
    });
    
    await User.findByIdAndUpdate(contactId, {
      $pull: { contacts: req.userId }
    });
    
    // Optionally delete all messages between them
    await Message.deleteMany({
      $or: [
        { sender: req.userId, receiver: contactId },
        { sender: contactId, receiver: req.userId }
      ]
    });
    
    res.json({ message: 'Contact deleted' });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;