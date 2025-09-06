const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected peers
const connectedPeers = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Add peer to the list
  connectedPeers.set(socket.id, {
    id: socket.id,
    timestamp: Date.now()
  });
  
  // Broadcast updated peer list to all clients
  io.emit('peer-list-updated', Array.from(connectedPeers.keys()));
  
  // Handle signaling messages
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });
  
  socket.on('answer', (data) => {
    console.log(`Answer from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });
  
  socket.on('ice-candidate', (data) => {
    console.log(`ICE candidate from ${socket.id} to ${data.target}`);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    connectedPeers.delete(socket.id);
    
    // Broadcast updated peer list
    io.emit('peer-list-updated', Array.from(connectedPeers.keys()));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 P2P Chat Server running on port ${PORT}`);
  console.log(`📱 Connect from other devices: http://<this-device-ip>:${PORT}`);
  console.log(`💻 Local access: http://localhost:${PORT}`);
});

// Get local IP address
const { networkInterfaces } = require('os');
const nets = networkInterfaces();
const results = {};

for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;
    if (net.family === familyV4Value && !net.internal) {
      if (!results[name]) {
        results[name] = [];
      }
      results[name].push(net.address);
    }
  }
}

// Display available network interfaces
setTimeout(() => {
  console.log('\n📡 Available network addresses:');
  Object.keys(results).forEach(name => {
    results[name].forEach(ip => {
      console.log(`   http://${ip}:${PORT}`);
    });
  });
  console.log('\n');
}, 1000);