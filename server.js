const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);

/* ===========================
   SOCKET.IO
=========================== */
const io = new socketIO.Server(server, {
  pingTimeout: 60000,
  cors: {
    origin: true,
    credentials: true
  }
});

/* ===========================
   MIDDLEWARE
=========================== */
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ===========================
   API ROUTES
=========================== */
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running' });
});

/* ===========================
   DATABASE CONNECTION
=========================== */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err.message));
  console.log("MONGO_URI:", process.env.MONGO_URI);

/* ===========================
   SOCKET AUTHENTICATION
=========================== */
const users = new Map();
const typingUsers = new Map();

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error('Unauthorized'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;

    next();
  } catch {
    next(new Error('Auth failed'));
  }
});

/* ===========================
   SOCKET CONNECTION
=========================== */
io.on('connection', async (socket) => {
  try {
    console.log('🔌 Connected:', socket.userId);

    if (!socket.userId) return socket.disconnect(true);

    // Prevent duplicate mapping
    users.set(socket.userId, socket.id);

    await User.findByIdAndUpdate(socket.userId, { online: true });

    const user = await User.findById(socket.userId)
      .populate('contacts', 'username email online');

    if (user && Array.isArray(user.contacts)) {
      socket.emit('contacts_list', user.contacts);

      user.contacts.forEach(contact => {
        if (!contact?._id) return;

        const contactSocket = users.get(contact._id.toString());

        if (contactSocket) {
          io.to(contactSocket).emit('user_online', {
            userId: socket.userId,
            online: true
          });
        }
      });
    } else {
      socket.emit('contacts_list', []);
    }

    /* ===========================
       ADVANCED TYPING SYSTEM
    =========================== */

   socket.on('typing', ({ receiverId }) => {

    if (!receiverId || !socket.userId) return;

    const receiverSocket = users.get(receiverId);

    if (!receiverSocket) return;

    io.to(receiverSocket).emit('user_typing', {
        userId: socket.userId,
        isTyping: true
    });
});

socket.on('stop_typing', ({ receiverId }) => {

    if (!receiverId || !socket.userId) return;

    const receiverSocket = users.get(receiverId);

    if (!receiverSocket) return;

    io.to(receiverSocket).emit('user_typing', {
        userId: socket.userId,
        isTyping: false
    });
});

    /* ===========================
       HEARTBEAT
    =========================== */
    socket.on('ping_check', () => {
      socket.emit('pong_check');
    });

    /* ===========================
       MESSAGE SYSTEM
    =========================== */
    socket.on('send_message', async (data) => {
      try {
        if (!data) return;

        const { receiverId, text, file } = data;

        if (!receiverId) return;

        const messageData = {
          sender: socket.userId,
          receiver: receiverId,
          text: text || '',
          timestamp: new Date(),
          status: 'sent'
        };

        if (file) {
          messageData.fileData = file.data;
          messageData.fileName = file.name;
          messageData.fileType = file.type;
          messageData.fileSize = file.size;
        }

        const message = new Message(messageData);
        await message.save();

        const receiverSocket = users.get(receiverId);

        if (receiverSocket) {
          message.status = 'delivered';
          await message.save();

          io.to(receiverSocket).emit('receive_message', message);
          socket.emit('message_delivered', { messageId: message._id });
        }

        socket.emit('message_sent', message);

      } catch (error) {
        console.error('❌ Send error:', error.message);
      }
    });
	

    /* ===========================
       DISCONNECT HANDLER
    =========================== */
    socket.on('disconnect', async () => {
      try {
        console.log('🔌 Disconnected:', socket.userId);

        if (!socket.userId) return;

        users.delete(socket.userId);

        await User.findByIdAndUpdate(socket.userId, { online: false });

        const user = await User.findById(socket.userId)
          .populate('contacts', '_id');

        if (user && Array.isArray(user.contacts)) {
          user.contacts.forEach(contact => {
            if (!contact?._id) return;

            const contactSocket = users.get(contact._id.toString());

            if (contactSocket) {
              io.to(contactSocket).emit('user_online', {
                userId: socket.userId,
                online: false
              });
            }
          });
        }
      } catch (error) {
        console.error('❌ Disconnect error:', error.message);
      }
    });

  } catch (error) {
    console.error('Socket connection error:', error.message);
  }
});

/* ===========================
   FRONTEND ROUTING FALLBACK
=========================== */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ===========================
   SERVER START
=========================== */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});