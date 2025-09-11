// P2P WebChat Client Application
class P2PWebChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.peers = new Map();
        this.rooms = new Map();
        this.peerConnections = new Map();
        this.dataChannels = new Map();
        this.fileTransfers = new Map();
        this.currentChat = null;
        
        // WebRTC Configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.init();
    }

    init() {
        this.initializeIndexedDB();
        this.checkSession();
        this.setupEventListeners();
    }

    // Session Management
    checkSession() {
        const session = localStorage.getItem('p2p_session');
        if (session) {
            const sessionData = JSON.parse(session);
            const now = new Date().getTime();
            
            if (sessionData.expiry > now) {
                this.currentUser = sessionData;
                this.showApp();
                this.connectToServer();
                return;
            }
        }
        this.showUserSetup();
    }

    saveSession(userData) {
        const expiry = new Date().getTime() + (30 * 60 * 1000); // 30 minutes
        const sessionData = { ...userData, expiry };
        localStorage.setItem('p2p_session', JSON.stringify(sessionData));
        this.currentUser = sessionData;
    }

    // UI Management
    showUserSetup() {
        document.getElementById('userSetupModal').classList.remove('hidden');
        document.getElementById('appContainer').classList.add('hidden');
    }

    showApp() {
        document.getElementById('userSetupModal').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        document.getElementById('currentUserName').textContent = this.currentUser.name;
    }

    // Socket.IO Connection
    connectToServer() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.updateConnectionStatus(true);
            this.socket.emit('user:join', {
                name: this.currentUser.name,
                userId: this.currentUser.userId
            });
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus(false);
        });

        this.socket.on('user:joined', (data) => {
            this.currentUser.userId = data.userId;
            this.saveSession(this.currentUser);
        });

        this.socket.on('user:list', (users) => {
            this.updatePeersList(users);
        });

        this.socket.on('room:list', (rooms) => {
            this.updateRoomsList(rooms);
        });

        this.socket.on('room:created', (data) => {
            this.showNotification('Room created successfully', 'success');
            this.hideRoomModal();
            // Auto-join the created room
            setTimeout(() => {
                this.joinRoom(data.roomId);
            }, 500);
        });

        this.socket.on('room:joined', (data) => {
            this.showNotification(`Joined room: ${data.room.name}`, 'success');
            // Auto-open room chat
            setTimeout(() => {
                this.startRoomChat(data.roomId);
            }, 300);
        });

        this.socket.on('room:kicked', (data) => {
            this.showNotification('You were removed from the room', 'warning');
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.closeChat();
            }
        });

        this.socket.on('room:left', (data) => {
            this.showNotification('Left room successfully', 'success');
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.closeChat();
            }
        });

        this.socket.on('error', (data) => {
            this.showNotification(data.message, 'error');
        });

        // WebRTC Signaling
        this.socket.on('signal:offer', (data) => {
            this.handleWebRTCOffer(data);
        });

        this.socket.on('signal:answer', (data) => {
            this.handleWebRTCAnswer(data);
        });

        this.socket.on('signal:ice', (data) => {
            this.handleWebRTCIce(data);
        });

        this.socket.on('room:update', (data) => {
            // Update room in local storage
            this.rooms.set(data.roomId, data.room);
            this.updateRoomsList(Array.from(this.rooms.values()));
        });

        // File Transfer Fallback
        this.socket.on('file:start', (data) => {
            this.handleFileTransferStart(data);
        });

        this.socket.on('file:chunk', (data) => {
            this.handleFileTransferChunk(data);
        });

        this.socket.on('file:end', (data) => {
            this.handleFileTransferEnd(data);
        });

        // Room message handling
        this.socket.on('room:message', (data) => {
            if (this.currentChat && this.currentChat.type === 'room' && this.currentChat.id === data.roomId) {
                this.displayMessage(data.message, false);
                this.saveChatMessage(data.roomId, data.message);
            }
        });
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connectionStatus');
        indicator.classList.toggle('disconnected', !connected);
    }

    // Event Listeners Setup
    setupEventListeners() {
        // User Setup
        document.getElementById('joinNetworkBtn').addEventListener('click', () => {
            const name = document.getElementById('displayNameInput').value.trim();
            if (name) {
                this.saveSession({ name });
                this.showApp();
                this.connectToServer();
            }
        });

        // Tab Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Room Creation
        document.getElementById('createPublicRoomBtn').addEventListener('click', () => {
            this.showRoomModal(false);
        });

        document.getElementById('createPrivateRoomBtn').addEventListener('click', () => {
            this.showRoomModal(true);
        });

        document.getElementById('createRoomBtn').addEventListener('click', () => {
            this.createRoom();
        });

        document.getElementById('cancelRoomBtn').addEventListener('click', () => {
            this.hideRoomModal();
        });

        // Private Room Join
        document.getElementById('joinPrivateRoomBtn').addEventListener('click', () => {
            const pin = document.getElementById('privateRoomPin').value;
            if (pin && pin.length === 4) {
                // Find private room and join
                this.joinRoomWithPin(pin);
            }
        });

        // Chat
        document.getElementById('closeChatBtn').addEventListener('click', () => {
            this.closeChat();
        });

        document.getElementById('sendMessageBtn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // File Upload
        document.getElementById('attachFileBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                Array.from(e.target.files).forEach(file => {
                    this.sendFile(file);
                });
                e.target.value = '';
            }
        });

        // Peer Search
        document.getElementById('peerSearchInput').addEventListener('input', (e) => {
            this.filterPeers(e.target.value);
        });
    }

    // Tab Management
    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
    }

    // Room Management
    showRoomModal(isPrivate) {
        document.getElementById('roomModal').classList.remove('hidden');
        document.getElementById('roomModalTitle').textContent = 
            isPrivate ? 'Create Private Room' : 'Create Public Room';
        document.getElementById('pinSection').classList.toggle('hidden', !isPrivate);
        document.getElementById('roomNameInput').value = '';
        document.getElementById('roomPinInput').value = '';
        document.getElementById('roomNameInput').focus();
    }

    hideRoomModal() {
        document.getElementById('roomModal').classList.add('hidden');
    }

    createRoom() {
        const name = document.getElementById('roomNameInput').value.trim();
        const isPrivate = !document.getElementById('pinSection').classList.contains('hidden');
        const pin = document.getElementById('roomPinInput').value;

        if (!name) {
            this.showNotification('Please enter a room name', 'error');
            return;
        }

        if (isPrivate && (!pin || pin.length !== 4)) {
            this.showNotification('Please enter a 4-digit PIN', 'error');
            return;
        }

        this.socket.emit('room:create', { name, isPrivate, pin });
    }

    joinRoom(roomId, pin = null) {
        this.socket.emit('room:join', { roomId, pin });
    }

    joinRoomWithPin(pin) {
        // This would need to be enhanced to find the room by PIN
        this.showNotification('Feature coming soon: Join by PIN', 'info');
    }

    // Peer and Room List Updates
    updatePeersList(users) {
        const container = document.getElementById('peersList');
        container.innerHTML = '';

        users.filter(user => user.id !== this.currentUser.userId).forEach(user => {
            const tile = this.createPeerTile(user);
            container.appendChild(tile);
        });

        this.peers.clear();
        users.forEach(user => {
            this.peers.set(user.id, user);
        });
    }

    updateRoomsList(rooms) {
        const publicContainer = document.getElementById('publicRoomsList');
        const privateContainer = document.getElementById('privateRoomsList');
        
        publicContainer.innerHTML = '';
        privateContainer.innerHTML = '';

        rooms.forEach(room => {
            const tile = this.createRoomTile(room);
            if (room.isPrivate) {
                privateContainer.appendChild(tile);
            } else {
                publicContainer.appendChild(tile);
            }
        });

        this.rooms.clear();
        rooms.forEach(room => {
            this.rooms.set(room.id, room);
        });
    }

    createPeerTile(user) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.innerHTML = `
            <div class="tile-header">
                <span class="tile-title">${this.escapeHtml(user.name)}</span>
                <span class="connection-status"></span>
            </div>
            <div class="tile-info">ID: ${user.id.substring(0, 8)}...</div>
            <div class="tile-actions">
                <button class="tile-btn" onclick="app.startChat('${user.id}')">Chat</button>
            </div>
        `;
        return tile;
    }

    createRoomTile(room) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        
        const isLead = room.leadUserId === this.currentUser.userId;
        const isMember = room.members.some(m => m.id === this.currentUser.userId);
        
        tile.innerHTML = `
            <div class="tile-header">
                <span class="tile-title">${this.escapeHtml(room.name)}</span>
                <span class="tile-badge ${room.isPrivate ? 'private' : ''}">${room.isPrivate ? 'Private' : 'Public'}</span>
            </div>
            <div class="tile-info">${room.members.length} member(s) ${isMember ? '• Joined' : ''}</div>
            <div class="tile-actions">
                ${!isMember ? `<button class="tile-btn" onclick="app.joinRoom('${room.id}')">Join</button>` : ''}
                ${isMember ? `<button class="tile-btn" onclick="app.startRoomChat('${room.id}')">Open Chat</button>` : ''}
                ${isLead && isMember ? `<button class="tile-btn danger" onclick="app.leaveRoom('${room.id}')">Leave</button>` : ''}
            </div>
        `;
        return tile;
    }

    filterPeers(searchTerm) {
        const tiles = document.querySelectorAll('#peersList .tile');
        tiles.forEach(tile => {
            const title = tile.querySelector('.tile-title').textContent.toLowerCase();
            const info = tile.querySelector('.tile-info').textContent.toLowerCase();
            const matches = title.includes(searchTerm.toLowerCase()) || info.includes(searchTerm.toLowerCase());
            tile.style.display = matches ? 'block' : 'none';
        });
    }

    // Chat Management
    startChat(peerId) {
        this.currentChat = { type: 'peer', id: peerId };
        const peer = this.peers.get(peerId);
        
        document.getElementById('chatTitle').textContent = `Chat with ${peer.name}`;
        document.getElementById('chatPanel').classList.remove('hidden');
        
        this.loadChatHistory(peerId);
        this.initWebRTCConnection(peerId);
    }

    startRoomChat(roomId) {
        this.currentChat = { type: 'room', id: roomId };
        const room = this.rooms.get(roomId);
        
        document.getElementById('chatTitle').textContent = `Room: ${room.name}`;
        document.getElementById('chatPanel').classList.remove('hidden');
        
        this.loadChatHistory(roomId);
    }

    closeChat() {
        const chatPanel = document.getElementById('chatPanel');
        chatPanel.classList.add('hidden');
        this.currentChat = null;
        
        // Clear chat messages to prevent UI issues
        document.getElementById('chatMessages').innerHTML = '';
        document.getElementById('messageInput').value = '';
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        
        if (!message || !this.currentChat) return;

        const messageData = {
            id: this.generateId(),
            text: message,
            timestamp: new Date(),
            sender: this.currentUser.userId
        };

        this.displayMessage(messageData, true);
        
        if (this.currentChat.type === 'peer') {
            this.sendPeerMessage(this.currentChat.id, messageData);
        } else if (this.currentChat.type === 'room') {
            this.sendRoomMessage(this.currentChat.id, messageData);
        }

        input.value = '';
        this.saveChatMessage(this.currentChat.id, messageData);
    }

    displayMessage(message, isSent) {
        const container = document.getElementById('chatMessages');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
        
        messageEl.innerHTML = `
            <div>${this.escapeHtml(message.text)}</div>
            <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
        `;
        
        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
    }

    // WebRTC Implementation
    async initWebRTCConnection(peerId) {
        if (this.peerConnections.has(peerId)) return;

        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(peerId, pc);

        // Create data channel
        const dataChannel = pc.createDataChannel('messages', { ordered: true });
        this.setupDataChannel(dataChannel, peerId);

        pc.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, peerId);
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('signal:ice', {
                    targetUserId: peerId,
                    candidate: event.candidate
                });
            }
        };

        // Create offer
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this.socket.emit('signal:offer', {
                targetUserId: peerId,
                offer: offer
            });
        } catch (error) {
            console.error('Error creating WebRTC offer:', error);
        }
    }

    async handleWebRTCOffer(data) {
        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(data.fromUserId, pc);

        pc.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, data.fromUserId);
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('signal:ice', {
                    targetUserId: data.fromUserId,
                    candidate: event.candidate
                });
            }
        };

        try {
            await pc.setRemoteDescription(data.offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.socket.emit('signal:answer', {
                targetUserId: data.fromUserId,
                answer: answer
            });
        } catch (error) {
            console.error('Error handling WebRTC offer:', error);
        }
    }

    async handleWebRTCAnswer(data) {
        const pc = this.peerConnections.get(data.fromUserId);
        if (pc) {
            try {
                await pc.setRemoteDescription(data.answer);
            } catch (error) {
                console.error('Error handling WebRTC answer:', error);
            }
        }
    }

    async handleWebRTCIce(data) {
        const pc = this.peerConnections.get(data.fromUserId);
        if (pc) {
            try {
                await pc.addIceCandidate(data.candidate);
            } catch (error) {
                console.error('Error handling ICE candidate:', error);
            }
        }
    }

    setupDataChannel(dataChannel, peerId) {
        this.dataChannels.set(peerId, dataChannel);
        
        dataChannel.onopen = () => {
            console.log('Data channel opened with', peerId);
            this.updatePeerConnectionStatus(peerId, 'connected');
        };

        dataChannel.onclose = () => {
            console.log('Data channel closed with', peerId);
            this.updatePeerConnectionStatus(peerId, 'disconnected');
        };

        dataChannel.onmessage = (event) => {
            this.handleDataChannelMessage(peerId, event.data);
        };
    }

    sendPeerMessage(peerId, message) {
        const dataChannel = this.dataChannels.get(peerId);
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'message', data: message }));
        } else {
            // Fallback to server relay
            this.socket.emit('message:send', {
                targetUserId: peerId,
                message: message
            });
        }
    }

    handleDataChannelMessage(peerId, data) {
        try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'message') {
                this.displayMessage(parsed.data, false);
                this.saveChatMessage(peerId, parsed.data);
            } else if (parsed.type === 'file-chunk') {
                this.handleFileChunk(peerId, parsed.data);
            }
        } catch (error) {
            console.error('Error parsing data channel message:', error);
        }
    }

    updatePeerConnectionStatus(peerId, status) {
        // Update UI to show connection status
        const peerTiles = document.querySelectorAll(`[onclick*="${peerId}"]`);
        peerTiles.forEach(tile => {
            const statusEl = tile.querySelector('.connection-status');
            if (statusEl) {
                statusEl.className = `connection-status ${status}`;
            }
        });
    }

    // File Transfer Implementation
    async sendFile(file) {
        if (!this.currentChat || this.currentChat.type !== 'peer') {
            this.showNotification('File sharing only available in peer chats', 'error');
            return;
        }

        const fileId = this.generateId();
        const chunkSize = 512 * 1024; // 512KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        const fileData = {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            totalChunks: totalChunks
        };

        this.fileTransfers.set(fileId, {
            ...fileData,
            chunks: new Map(),
            progress: 0,
            direction: 'sending'
        });

        this.showFileProgress(fileData, 0);

        const dataChannel = this.dataChannels.get(this.currentChat.id);
        const useWebRTC = dataChannel && dataChannel.readyState === 'open';

        if (useWebRTC) {
            // Send via WebRTC
            dataChannel.send(JSON.stringify({
                type: 'file-start',
                data: fileData
            }));

            // Send chunks
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const arrayBuffer = await chunk.arrayBuffer();
                const base64 = this.arrayBufferToBase64(arrayBuffer);
                
                dataChannel.send(JSON.stringify({
                    type: 'file-chunk',
                    data: { fileId, chunkIndex: i, chunk: base64 }
                }));

                const progress = ((i + 1) / totalChunks) * 100;
                this.updateFileProgress(fileId, progress);
                
                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            dataChannel.send(JSON.stringify({
                type: 'file-end',
                data: { fileId }
            }));
        } else {
            // Fallback to server relay
            this.socket.emit('file:start', {
                targetUserId: this.currentChat.id,
                fileId: fileId,
                fileName: file.name,
                fileSize: file.size,
                totalChunks: totalChunks
            });

            // Send chunks via socket
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const chunk = file.slice(start, end);
                
                const arrayBuffer = await chunk.arrayBuffer();
                const base64 = this.arrayBufferToBase64(arrayBuffer);
                
                this.socket.emit('file:chunk', {
                    targetUserId: this.currentChat.id,
                    fileId: fileId,
                    chunkIndex: i,
                    chunk: base64
                });

                const progress = ((i + 1) / totalChunks) * 100;
                this.updateFileProgress(fileId, progress);
                
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            this.socket.emit('file:end', {
                targetUserId: this.currentChat.id,
                fileId: fileId
            });
        }
    }

    handleFileTransferStart(data) {
        this.fileTransfers.set(data.fileId, {
            id: data.fileId,
            name: data.fileName,
            size: data.fileSize,
            totalChunks: data.totalChunks,
            chunks: new Map(),
            progress: 0,
            direction: 'receiving'
        });

        this.showFileProgress(data, 0);
        this.displayFileMessage(data, false);
    }

    handleFileTransferChunk(data) {
        const transfer = this.fileTransfers.get(data.fileId);
        if (transfer) {
            transfer.chunks.set(data.chunkIndex, data.chunk);
            const progress = (transfer.chunks.size / transfer.totalChunks) * 100;
            transfer.progress = progress;
            this.updateFileProgress(data.fileId, progress);
        }
    }

    handleFileTransferEnd(data) {
        const transfer = this.fileTransfers.get(data.fileId);
        if (transfer && transfer.chunks.size === transfer.totalChunks) {
            this.assembleFile(transfer);
        }
    }

    async assembleFile(transfer) {
        const chunks = [];
        for (let i = 0; i < transfer.totalChunks; i++) {
            const base64Chunk = transfer.chunks.get(i);
            if (base64Chunk) {
                chunks.push(this.base64ToArrayBuffer(base64Chunk));
            }
        }

        const blob = new Blob(chunks);
        const url = URL.createObjectURL(blob);
        
        // Store in IndexedDB
        await this.storeFile(transfer.id, {
            name: transfer.name,
            size: transfer.size,
            blob: blob,
            url: url
        });

        this.hideFileProgress();
        this.showNotification(`File received: ${transfer.name}`, 'success');
        
        // Auto-download
        const a = document.createElement('a');
        a.href = url;
        a.download = transfer.name;
        a.click();
    }

    showFileProgress(fileData, progress) {
        document.getElementById('fileTransferProgress').classList.remove('hidden');
        document.getElementById('progressFileName').textContent = fileData.name;
        this.updateFileProgress(fileData.id, progress);
    }

    updateFileProgress(fileId, progress) {
        document.getElementById('progressPercent').textContent = `${Math.round(progress)}%`;
        document.getElementById('progressFill').style.width = `${progress}%`;
    }

    hideFileProgress() {
        document.getElementById('fileTransferProgress').classList.add('hidden');
    }

    displayFileMessage(fileData, isSent) {
        const container = document.getElementById('chatMessages');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
        
        messageEl.innerHTML = `
            <div class="file-message">
                <div class="file-info">
                    <span class="file-icon">📎</span>
                    <div class="file-details">
                        <div class="file-name">${this.escapeHtml(fileData.name)}</div>
                        <div class="file-size">${this.formatFileSize(fileData.size)}</div>
                    </div>
                </div>
            </div>
            <div class="message-time">${new Date().toLocaleTimeString()}</div>
        `;
        
        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
    }

    // IndexedDB Implementation
    async initializeIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('P2PWebChat', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Chat messages store
                if (!db.objectStoreNames.contains('messages')) {
                    const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
                    messagesStore.createIndex('chatId', 'chatId', { unique: false });
                    messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Files store
                if (!db.objectStoreNames.contains('files')) {
                    const filesStore = db.createObjectStore('files', { keyPath: 'id' });
                }
            };
        });
    }

    async saveChatMessage(chatId, message) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['messages'], 'readwrite');
        const store = transaction.objectStore('messages');
        
        await store.add({
            id: this.generateId(),
            chatId: chatId,
            message: message,
            timestamp: new Date()
        });
    }

    async loadChatHistory(chatId) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['messages'], 'readonly');
        const store = transaction.objectStore('messages');
        const index = store.index('chatId');
        
        const request = index.getAll(chatId);
        request.onsuccess = () => {
            const messages = request.result;
            const container = document.getElementById('chatMessages');
            container.innerHTML = '';
            
            messages.forEach(record => {
                const isSent = record.message.sender === this.currentUser.userId;
                this.displayMessage(record.message, isSent);
            });
        };
    }

    async storeFile(fileId, fileData) {
        if (!this.db) return;
        
        const transaction = this.db.transaction(['files'], 'readwrite');
        const store = transaction.objectStore('files');
        
        await store.add({
            id: fileId,
            ...fileData,
            timestamp: new Date()
        });
    }

    // Room messaging
    sendRoomMessage(roomId, message) {
        // Send room message via Socket.IO
        this.socket.emit('room:message', {
            roomId: roomId,
            message: message
        });
    }

    // Utility Functions
    generateId() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    leaveRoom(roomId) {
        this.socket.emit('room:leave', { roomId });
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        container.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Initialize the application
const app = new P2PWebChat();
