// Global Variables
const API_BASE = "/api";
const API_URL = window.location.origin + "/api";
const SOCKET_URL = window.location.origin;

let socket;
let currentUser;
let contacts = [];
let selectedContact = null;
let messages = {};
let typingUsers = {};
let contactToDelete = null;

// Load unread counts from localStorage or initialize
let unreadCounts = JSON.parse(localStorage.getItem('unreadCounts') || '{}');

// Save unread counts to localStorage whenever they change
function saveUnreadCounts() {
    localStorage.setItem('unreadCounts', JSON.stringify(unreadCounts));
}

// Auth Functions
function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

async function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    hideError(errorDiv);
    
    if (!email || !password) {
        showError(errorDiv, 'Please fill all fields');
        return;
    }
    
    try {
        const res = await fetch("/api/auth/login", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message);
        
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        currentUser = data.user;
        showApp();
        
    } catch (error) {
        showError(errorDiv, error.message);
    }
}


async function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errorDiv = document.getElementById('registerError');
    const successDiv = document.getElementById('registerSuccess');
    
    hideError(errorDiv);
    hideError(successDiv);
    
    if (!username || !email || !password) {
        showError(errorDiv, 'Please fill all fields');
        return;
    }
    
    if (password.length < 6) {
        showError(errorDiv, 'Password must be at least 6 characters');
        return;
    }
    
try {
    const res = await fetch("/api/auth/register", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message);

    showSuccess(successDiv, 'Account created! Logging you in...');

    setTimeout(() => {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        currentUser = data.user;
        showApp();
    }, 1500);

} catch (error) {
    showError(errorDiv, error.message);
}};

function logout() {
    if (socket) socket.disconnect();
    localStorage.clear();
    location.reload();
}

// App Functions
function showApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
    
    const initials = currentUser.username.substring(0, 2).toUpperCase();
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('username').textContent = currentUser.username;
    
    connectSocket();
    loadContacts();
}

function connectSocket() {
    const token = localStorage.getItem('token');
    
    socket = io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
        console.log('✅ Connected');
        updateStatus(true);
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Disconnected');
        updateStatus(false);
    });
    
    socket.on('contacts_list', (contactsList) => {
        console.log('📋 Contacts:', contactsList);
        contacts = contactsList;
        renderContacts();
    });
    
    socket.on('user_online', ({ userId, online }) => {
        updateContactStatus(userId, online);
    });
    
    socket.on('receive_message', (message) => {
        console.log('📩 Message received:', message);
        handleIncomingMessage(message);
    });
    
    socket.on('message_sent', (message) => {
        console.log('✅ Message sent confirmation');
        updateMessageStatus(message._id, 'sent');
    });
    
    socket.on('message_delivered', (data) => {
        console.log('✓✓ Message delivered:', data.messageId);
        updateMessageStatus(data.messageId, 'delivered');
    });
    
    socket.on('message_read', (data) => {
        console.log('✓✓✓ Message read:', data.messageId);
        updateMessageStatus(data.messageId, 'read');
    });
    
    socket.on('messages_read', (data) => {
        console.log('✓✓✓ All messages read from:', data.userId);
        markAllMessagesAsRead(data.userId);
    });
    
    socket.on('user_typing', ({ userId, isTyping }) => {
        handleTypingIndicator(userId, isTyping);
    });
}

function updateStatus(connected) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    
    if (connected) {
        dot.classList.remove('offline');
        text.textContent = 'Connected';
    } else {
        dot.classList.add('offline');
        text.textContent = 'Disconnected';
    }
}

async function loadContacts() {
    try {
        const token = localStorage.getItem('token');
       const res = await fetch("/api/users/contacts", {
    headers: {
        "Authorization": `Bearer ${localStorage.getItem("token")}`
    }
});
        if (!res.ok) throw new Error('Failed to load contacts');
        
        contacts = await res.json();
        renderContacts();
        
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

function renderContacts() {
    const list = document.getElementById('contactsList');
    
    if (contacts.length === 0) {
        list.innerHTML = '<div class="no-contacts">No contacts yet. Click + to add contacts!</div>';
        return;
    }
    
    list.innerHTML = '';
    
    contacts.forEach(contact => {
        const div = document.createElement('div');
        div.className = 'contact' + (selectedContact && selectedContact._id === contact._id ? ' active' : '');
        
        const initials = contact.username.substring(0, 2).toUpperCase();
        const statusClass = contact.online ? '' : 'offline';
        const unreadCount = unreadCounts[contact._id] || 0;
        const isTyping = typingUsers[contact._id];
        
        div.innerHTML = `
            <div class="avatar small">${initials}</div>
            <div class="contact-info">
                <div class="contact-name">${contact.username}</div>
                ${isTyping ? 
                    '<div class="contact-typing">typing<span class="typing-dots">...</span></div>' :
                    `<div class="contact-status ${statusClass}">${contact.online ? 'Online' : 'Offline'}</div>`
                }
            </div>
            ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
            <button class="contact-delete" onclick="event.stopPropagation(); openDeleteModal('${contact._id}', '${contact.username}')">🗑️</button>
        `;
        
        div.onclick = () => selectContact(contact);
        
        list.appendChild(div);
    });
}

function updateContactStatus(userId, online) {
    const contact = contacts.find(c => c._id === userId);
    if (contact) {
        contact.online = online;
        renderContacts();
        
        if (selectedContact && selectedContact._id === userId) {
            const statusEl = document.getElementById('chatStatus');
            statusEl.textContent = online ? 'Online' : 'Offline';
            statusEl.className = online ? 'chat-status' : 'chat-status offline';
        }
    }
}

function handleTypingIndicator(userId, isTyping) {

    if (!userId) return;

    if (isTyping) {
        typingUsers[userId] = true;
    } else {
        delete typingUsers[userId];
    }

    // Refresh contact list UI if function exists
    if (typeof renderContacts === "function") {
        renderContacts();
    }

    // Show typing indicator in active chat
    if (selectedContact && selectedContact._id === userId) {

        const typingEl = document.getElementById('typingIndicator');

        if (!typingEl) return;

        typingEl.style.display = isTyping ? "flex" : "none";
    }
}

async function addContact() {
    const input = document.getElementById('addContactInput');
    const code = input.value.trim().toUpperCase();
    
    if (!code) {
        alert('Please enter an invite code');
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch("/api/users/add-contact", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ inviteCode: code })
        });
        
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message);
        
        alert('✅ Contact added!');
        input.value = '';
        closeContactModal(); // Close modal after adding
        loadContacts();
        
    } catch (error) {
        alert('❌ ' + error.message);
    }
}

async function selectContact(contact) {
    selectedContact = contact;
    
    // Mark messages as read
    if (unreadCounts[contact._id] && unreadCounts[contact._id] > 0) {
        unreadCounts[contact._id] = 0;
        saveUnreadCounts(); // PERSIST TO LOCALSTORAGE
        if (socket) {
            socket.emit('messages_read', { userId: contact._id });
        }
    }
    
    // Show chat UI
    document.getElementById('emptyChat').style.display = 'none';
    document.getElementById('chatContainer').style.display = 'flex';
    
    const initials = contact.username.substring(0, 2).toUpperCase();
    document.getElementById('chatAvatar').textContent = initials;
    document.getElementById('chatName').textContent = contact.username;
    
    const statusEl = document.getElementById('chatStatus');
    statusEl.textContent = contact.online ? 'Online' : 'Offline';
    statusEl.className = contact.online ? 'chat-status' : 'chat-status offline';
    
    // Load messages
    await loadMessages(contact._id);
    renderMessages();
    
    // Update contacts list
    renderContacts();
    
    // Mobile: hide sidebar, show chat, show back button
    if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.add('hidden');
        document.querySelector('.chat-area').classList.add('active');
        document.querySelector('.back-button').style.display = 'flex';
    }
}

// Add function to go back to contacts on mobile
function backToContacts() {
    if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.remove('hidden');
        document.querySelector('.chat-area').classList.remove('active');
        document.querySelector('.back-button').style.display = 'none';
    }
}

async function loadMessages(contactId) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/users/messages/${contactId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to load messages');
        
        const data = await res.json();
        messages[contactId] = data;
        
    } catch (error) {
        console.error('Error loading messages:', error);
        messages[contactId] = [];
    }
}

function renderMessages() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    
    if (!selectedContact) return;
    
    const contactMessages = messages[selectedContact._id] || [];
    
    contactMessages.forEach(msg => {
        const isSent = msg.sender === currentUser._id;
        const div = document.createElement('div');
        div.className = isSent ? 'message sent' : 'message received';
        div.dataset.messageId = msg._id;
        
        const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });
        
        // Handle files
        if (msg.fileData) {
            if (msg.fileType && msg.fileType.startsWith('image/')) {
                div.innerHTML = `
                    <img src="${msg.fileData}" class="message-image" onclick="viewImage('${msg.fileData.replace(/'/g, "\\'")}')">
                    <div class="message-meta">
                        <span class="message-time">${time}</span>
                        ${isSent ? getStatusIcon(msg.status || 'sent') : ''}
                    </div>
                `;
            } else {
                div.innerHTML = `
                    <div class="message-file">
                        <span class="file-icon">📄</span>
                        <div class="file-info">
                            <div class="file-name">${msg.fileName || 'File'}</div>
                            <a href="${msg.fileData}" download="${msg.fileName}" class="file-download">Download</a>
                        </div>
                    </div>
                    <div class="message-meta">
                        <span class="message-time">${time}</span>
                        ${isSent ? getStatusIcon(msg.status || 'sent') : ''}
                    </div>
                `;
            }
        } else {
            // Text message
            div.innerHTML = `
                <div class="message-text">${escapeHtml(msg.text)}</div>
                <div class="message-meta">
                    <span class="message-time">${time}</span>
                    ${isSent ? getStatusIcon(msg.status || 'sent') : ''}
                </div>
            `;
        }
        
        messagesDiv.appendChild(div);
    });
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function getStatusIcon(status) {
    const icons = {
        sending: '<span class="status-icon sending">○</span>',
        sent: '<span class="status-icon sent">✓</span>',
        delivered: '<span class="status-icon delivered">✓✓</span>',
        read: '<span class="status-icon read">✓✓</span>'
    };
    return icons[status] || icons.sent;
}

function updateMessageStatus(messageId, status) {
    // Update in messages array
    for (const contactId in messages) {
        const msg = messages[contactId].find(m => m._id === messageId);
        if (msg) {
            msg.status = status;
            break;
        }
    }
    
    // Update UI if currently viewing
    if (selectedContact) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            const statusEl = messageEl.querySelector('.status-icon');
            if (statusEl) {
                const icon = getStatusIcon(status);
                const temp = document.createElement('div');
                temp.innerHTML = icon;
                statusEl.replaceWith(temp.firstChild);
            }
        }
    }
}

function markAllMessagesAsRead(userId) {
    if (messages[userId]) {
        messages[userId].forEach(msg => {
            if (msg.sender === currentUser._id) {
                msg.status = 'read';
            }
        });
    }
    
    if (selectedContact && selectedContact._id === userId) {
        renderMessages();
    }
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !selectedContact) return;
    
    const tempId = 'temp_' + Date.now();
    const message = {
        _id: tempId,
        sender: currentUser._id,
        receiver: selectedContact._id,
        text: text,
        timestamp: new Date(),
        status: 'sending'
    };
    
    // Add to messages
    if (!messages[selectedContact._id]) {
        messages[selectedContact._id] = [];
    }
    messages[selectedContact._id].push(message);
    renderMessages();
    
    // Send via socket
    if (socket) {
        socket.emit('send_message', {
            receiverId: selectedContact._id,
            text: text
        });
    }
    
    input.value = '';
    
    // Stop typing indicator
    if (socket) {
        socket.emit('stop_typing', { receiverId: selectedContact._id });
    }
}

function handleIncomingMessage(message) {
    const contactId = message.sender === currentUser._id ? message.receiver : message.sender;
    
    // Initialize messages array if needed
    if (!messages[contactId]) {
        messages[contactId] = [];
    }
    
    // Check if message already exists
    const existingIndex = messages[contactId].findIndex(m => m._id === message._id);
    if (existingIndex === -1) {
        messages[contactId].push(message);
    } else {
        // Update existing message (for status updates)
        messages[contactId][existingIndex] = message;
    }
    
    // Update unread count ONLY if not currently viewing this chat
    if (!selectedContact || selectedContact._id !== contactId) {
        if (message.sender !== currentUser._id) {
            unreadCounts[contactId] = (unreadCounts[contactId] || 0) + 1;
            saveUnreadCounts(); // PERSIST TO LOCALSTORAGE
        }
    }
    
    // Send delivery receipt if we received it
    if (message.sender !== currentUser._id && socket) {
        socket.emit('message_delivered', {
            messageId: message._id,
            userId: message.sender
        });
        
        // If chat is open, mark as read immediately
        if (selectedContact && selectedContact._id === contactId) {
            socket.emit('message_read', {
                messageId: message._id,
                userId: message.sender
            });
        }
    }
    
    // Update UI - IMPORTANT: Re-render to show updated status
    if (selectedContact && selectedContact._id === contactId) {
        renderMessages();
    }
    renderContacts();
}

// Modal Functions
function openContactModal() {
    document.getElementById('contactModal').style.display = 'flex';
    
    // Always load invite code from currentUser object
    if (currentUser && currentUser.inviteCode) {
        document.getElementById('myInviteCodeDisplay').value = currentUser.inviteCode;
    } else {
        // Fallback 1: fetch from localStorage
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        if (storedUser.inviteCode) {
            currentUser.inviteCode = storedUser.inviteCode;
            document.getElementById('myInviteCodeDisplay').value = storedUser.inviteCode;
        } else {
            // Fallback 2: fetch from API
            document.getElementById('myInviteCodeDisplay').value = 'Loading...';
            fetchInviteCode();
        }
    }
}

async function fetchInviteCode() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/users/invite-code`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            currentUser.inviteCode = data.inviteCode;
            document.getElementById('myInviteCodeDisplay').value = data.inviteCode;
            
            // Update localStorage too
            const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
            storedUser.inviteCode = data.inviteCode;
            localStorage.setItem('user', JSON.stringify(storedUser));
        } else {
            document.getElementById('myInviteCodeDisplay').value = 'Error loading code';
        }
    } catch (error) {
        console.error('Failed to load invite code:', error);
        document.getElementById('myInviteCodeDisplay').value = 'Error loading code';
    }
}

function closeContactModal() {
    document.getElementById('contactModal').style.display = 'none';
    document.getElementById('addContactInput').value = '';
}

function copyInviteCode() {
    const codeInput = document.getElementById('myInviteCodeDisplay');
    codeInput.select();
    document.execCommand('copy');
    
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
        btn.textContent = originalText;
    }, 2000);
}

function openDeleteModal(contactId, contactName) {
    contactToDelete = contactId;
    document.getElementById('deleteContactName').textContent = contactName;
    document.getElementById('deleteContactModal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteContactModal').style.display = 'none';
    contactToDelete = null;
}

async function confirmDeleteContact() {
    if (!contactToDelete) return;
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/users/delete-contact/${contactToDelete}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to delete contact');
        
        // Remove from local state
        contacts = contacts.filter(c => c._id !== contactToDelete);
        delete messages[contactToDelete];
        delete unreadCounts[contactToDelete];
        saveUnreadCounts(); // PERSIST TO LOCALSTORAGE
        
        // If this was the selected contact, close chat
        if (selectedContact && selectedContact._id === contactToDelete) {
            selectedContact = null;
            document.getElementById('emptyChat').style.display = 'flex';
            document.getElementById('chatContainer').style.display = 'none';
            
            // Mobile: show sidebar
            if (window.innerWidth <= 768) {
                document.querySelector('.sidebar').classList.remove('hidden');
                document.querySelector('.chat-area').classList.remove('active');
            }
        }
        
        renderContacts();
        closeDeleteModal();
        
    } catch (error) {
        alert('❌ Failed to delete contact');
        console.error('Delete error:', error);
    }
}

// Close modals on backdrop click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeContactModal();
        closeDeleteModal();
    }
});

// Typing indicator
let typingTimeout;
document.getElementById('messageInput')?.addEventListener('input', () => {
    if (!selectedContact || !socket) return;
    
    socket.emit('typing', { receiverId: selectedContact._id });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing', { receiverId: selectedContact._id });
    }, 1000);
});

// Utility
function showError(el, msg) {
    el.textContent = msg;
    el.classList.add('show');
}

function hideError(el) {
    el.classList.remove('show');
}

function showSuccess(el, msg) {
    el.textContent = msg;
    el.classList.add('show');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Check if already logged in
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        currentUser = JSON.parse(user);
        showApp();
    }
});

// ========================================
// EMOJI PICKER
// ========================================

const emojis = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🌐','💠','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','▶️','⏸','⏯','⏹','⏺','⏭','⏮','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','💲','💱','™️','©️','®️','〰️','➰','➿','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','⬛','⬜','🟥','🟧','🟨','🟩','🟦','🟪','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯','♠️','♣️','♥️','♦️','🃏','🎴','🀄'];

function toggleEmoji() {
    const picker = document.getElementById('emojiPicker');
    
    if (picker.style.display === 'none' || !picker.style.display) {
        if (!picker.innerHTML) {
            const grid = document.createElement('div');
            grid.className = 'emoji-grid';
            
            emojis.forEach(emoji => {
                const item = document.createElement('span');
                item.className = 'emoji-item';
                item.textContent = emoji;
                item.onclick = () => insertEmoji(emoji);
                grid.appendChild(item);
            });
            
            picker.appendChild(grid);
        }
        picker.style.display = 'block';
    } else {
        picker.style.display = 'none';
    }
}

function insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    input.value += emoji;
    input.focus();
    document.getElementById('emojiPicker').style.display = 'none';
}

// Close emoji when clicking outside
document.addEventListener('click', (e) => {
    const picker = document.getElementById('emojiPicker');
    if (picker && !e.target.closest('.action-btn[onclick*="toggleEmoji"]') && !picker.contains(e.target)) {
        picker.style.display = 'none';
    }
});

// ========================================
// CAMERA
// ========================================

let cameraStream = null;

async function openCamera() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraVideo');
    
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = cameraStream;
        modal.style.display = 'flex';
    } catch (error) {
        alert('❌ Camera access denied or not available');
        console.error('Camera error:', error);
    }
}

function closeCamera() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraVideo');
    
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    
    video.srcObject = null;
    modal.style.display = 'none';
}

function capturePhoto() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    canvas.toBlob((blob) => {
        closeCamera();
        const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
        sendFileToChat(file);
    }, 'image/jpeg');
}

// ========================================
// FILE UPLOAD
// ========================================

document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 10 * 1024 * 1024) {
            alert('❌ File too large! Max 10MB');
            return;
        }
        sendFileToChat(file);
        e.target.value = '';
    }
});

function sendFileToChat(file) {
    if (!selectedContact) {
        alert('Please select a contact first');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const fileData = {
            name: file.name,
            type: file.type,
            size: file.size,
            data: e.target.result
        };
        
        // Create temporary message
        const tempId = 'temp_' + Date.now();
        const message = {
            _id: tempId,
            sender: currentUser._id,
            receiver: selectedContact._id,
            text: '',
            fileData: fileData.data,
            fileName: fileData.name,
            fileType: fileData.type,
            fileSize: fileData.size,
            timestamp: new Date(),
            status: 'sending'
        };
        
        // Add to messages
        if (!messages[selectedContact._id]) {
            messages[selectedContact._id] = [];
        }
        messages[selectedContact._id].push(message);
        renderMessages();
        
        // Send via socket
        if (socket) {
            socket.emit('send_message', {
                receiverId: selectedContact._id,
                text: '',
                file: fileData
            });
        }
    };
    reader.readAsDataURL(file);
}

// ========================================
// MODAL FUNCTIONS
// ========================================

// Modal Functions
function openContactModal() {
    // Always show the modal
    document.getElementById('contactModal').style.display = 'flex';
    
    // Set invite code - check multiple sources to ensure it's always available
    if (currentUser && currentUser.inviteCode) {
        document.getElementById('myInviteCodeDisplay').value = currentUser.inviteCode;
    } else {
        // Fallback: try to get from localStorage
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            try {
                const user = JSON.parse(storedUser);
                if (user.inviteCode) {
                    document.getElementById('myInviteCodeDisplay').value = user.inviteCode;
                    // Update currentUser if it's missing
                    if (!currentUser) {
                        currentUser = user;
                    }
                }
            } catch (e) {
                console.error('Error parsing stored user:', e);
            }
        }
    }
}

function closeContactModal() {
    document.getElementById('contactModal').style.display = 'none';
    document.getElementById('addContactInput').value = '';
}

function copyInviteCode() {
    const codeInput = document.getElementById('myInviteCodeDisplay');
    codeInput.select();
    codeInput.setSelectionRange(0, 99999); // For mobile
    
    try {
        document.execCommand('copy');
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    } catch (err) {
        // Fallback for modern browsers
        navigator.clipboard.writeText(codeInput.value).then(() => {
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        });
    }
}

function openDeleteModal(contactId, contactName) {
    contactToDelete = contactId;
    document.getElementById('deleteContactName').textContent = contactName;
    document.getElementById('deleteContactModal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteContactModal').style.display = 'none';
    contactToDelete = null;
}

async function confirmDeleteContact() {
    if (!contactToDelete) return;
    
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/users/delete-contact/${contactToDelete}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to delete contact');
        
        // Remove from local state
        contacts = contacts.filter(c => c._id !== contactToDelete);
        delete messages[contactToDelete];
        delete unreadCounts[contactToDelete];
        saveUnreadCounts(); // PERSIST TO LOCALSTORAGE
        
        // If this was the selected contact, close chat
        if (selectedContact && selectedContact._id === contactToDelete) {
            selectedContact = null;
            document.getElementById('emptyChat').style.display = 'flex';
            document.getElementById('chatContainer').style.display = 'none';
            
            // Mobile: show sidebar
            if (window.innerWidth <= 768) {
                document.querySelector('.sidebar').classList.remove('hidden');
                document.querySelector('.chat-area').classList.remove('active');
            }
        }
        
        renderContacts();
        closeDeleteModal();
        
    } catch (error) {
        alert('❌ Failed to delete contact');
        console.error('Delete error:', error);
    }
}

// ========================================
// IMAGE VIEWER MODAL
// ========================================

function viewImage(imageSrc) {
    // Create modal if it doesn't exist
    let imageModal = document.getElementById('imageViewerModal');
    if (!imageModal) {
        imageModal = document.createElement('div');
        imageModal.id = 'imageViewerModal';
        imageModal.className = 'image-viewer-modal';
        imageModal.innerHTML = `
            <div class="image-viewer-overlay" onclick="closeImageViewer()">
                <button class="image-viewer-close" onclick="closeImageViewer()">✕</button>
                <img id="imageViewerImg" src="" alt="Full size image">
            </div>
        `;
        document.body.appendChild(imageModal);
    }
    
    // Set image and show modal
    document.getElementById('imageViewerImg').src = imageSrc;
    imageModal.style.display = 'flex';
}

function closeImageViewer() {
    const imageModal = document.getElementById('imageViewerModal');
    if (imageModal) {
        imageModal.style.display = 'none';
    }
}

// Close modals on backdrop click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeContactModal();
        closeDeleteModal();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeContactModal();
        closeDeleteModal();
        closeImageViewer();
    }
});

// Image Viewer Function
function viewImage(imageSrc) {
    const modal = document.getElementById('imageViewerModal');
    const img = document.getElementById('viewerImage');
    img.src = imageSrc;
    modal.style.display = 'flex';
}

function closeImageViewer() {
    document.getElementById('imageViewerModal').style.display = 'none';
}

// Image Viewer Function
function viewImage(imageUrl) {
    const modal = document.getElementById('imageViewerModal');
    const img = document.getElementById('viewerImage');
    img.src = imageUrl;
    modal.style.display = 'flex';
}

function closeImageViewer() {
    document.getElementById('imageViewerModal').style.display = 'none';
}

// Forgot Password Functions
function showForgotPassword() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('forgotPasswordForm').style.display = 'block';
    document.getElementById('resetPasswordForm').style.display = 'none';
}

async function requestPasswordReset() {
    const email = document.getElementById('forgotEmail').value.trim();
    const errorDiv = document.getElementById('forgotError');
    const successDiv = document.getElementById('forgotSuccess');
    
    hideError(errorDiv);
    hideError(successDiv);
    
    if (!email) {
        showError(errorDiv, 'Please enter your email');
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message);
        
        showSuccess(successDiv, `Reset code sent to ${email}! Check your email.`);
        
        // Show reset form after 2 seconds
        setTimeout(() => {
            document.getElementById('forgotPasswordForm').style.display = 'none';
            document.getElementById('resetPasswordForm').style.display = 'block';
        }, 2000);
        
    } catch (error) {
        showError(errorDiv, error.message);
    }
}

async function resetPassword() {
    const resetCode = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorDiv = document.getElementById('resetError');
    const successDiv = document.getElementById('resetSuccess');
    
    hideError(errorDiv);
    hideError(successDiv);
    
    if (!resetCode || !newPassword || !confirmPassword) {
        showError(errorDiv, 'Please fill all fields');
        return;
    }
    
    if (newPassword.length < 6) {
        showError(errorDiv, 'Password must be at least 6 characters');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showError(errorDiv, 'Passwords do not match');
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resetCode, newPassword })
        });
        
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.message);
        
        showSuccess(successDiv, 'Password reset successful! Redirecting to login...');
        
        // Clear fields
        document.getElementById('resetCode').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        
        // Redirect to login after 2 seconds
        setTimeout(() => {
            showLogin();
        }, 2000);
        
    } catch (error) {
        showError(errorDiv, error.message);
    }
}



function mobileKeyboardFix() {
    if (window.innerWidth <= 768) {
        setTimeout(() => {
            document.activeElement?.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        }, 200);
    }
}

document.getElementById("messageInput")?.addEventListener("focus", mobileKeyboardFix);