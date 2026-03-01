/**
 * Relay Server V 1.3
 * Socket.IO + Express
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DATA_PATH = path.join(__dirname, '..', 'data');
const PORT = process.env.PORT || 15294;

let config = {};
let botStatus = { servers: [], timestamp: Date.now() };
let logs = [];
const MAX_LOGS = 500;
let learningData = {};
let playersData = {};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (error) {
        config = { servers: [], messages: [] };
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (error) {}
}

function loadData() {
    try {
        const lp = path.join(DATA_PATH, 'learning.json');
        if (fs.existsSync(lp)) learningData = JSON.parse(fs.readFileSync(lp, 'utf8'));
    } catch (e) {}
    try {
        const pp = path.join(DATA_PATH, 'players.json');
        if (fs.existsSync(pp)) playersData = JSON.parse(fs.readFileSync(pp, 'utf8'));
    } catch (e) {}
}

loadConfig();
loadData();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: ['http://localhost:15294', 'http://localhost:3000', 'https://ubiquitous-giggle-iva0.onrender.com'],
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const expectedToken = process.env.SECRET_KEY || config.relay?.token || 'seu-token-secreto-aqui';
    const isLocal = socket.handshake.address === '127.0.0.1' || socket.handshake.address === '::1';
    
    if (token === expectedToken || isLocal || process.env.NODE_ENV !== 'production') {
        return next();
    }
    return next(new Error('Auth failed'));
});

io.on('connection', (socket) => {
    console.log(`[RELAY] Cliente: ${socket.id}`);
    
    socket.emit('bot:status', botStatus);
    socket.emit('config', config);
    socket.emit('learning:data', learningData);
    socket.emit('players:data', playersData);
    socket.emit('bot:logs', logs.slice(-50));
    
    socket.on('bot:status', (status) => { botStatus = status; io.emit('bot:status', status); });
    socket.on('bot:log', (data) => { addLog(data.message, data.level, data.serverId); io.emit('bot:log', data); });
    socket.on('bot:player_event', (data) => io.emit('bot:player_event', data));
    socket.on('bot:player_list', (data) => io.emit('bot:player_list', data));
    
    socket.on('config:update', (newConfig) => { config = { ...config, ...newConfig }; saveConfig(); io.emit('config', config); });
    socket.on('server:add', (server) => { server.id = `srv_${Date.now()}`; server.enabled = true; config.servers = config.servers || []; config.servers.push(server); saveConfig(); io.emit('server:added', server); });
    socket.on('server:remove', (serverId) => { config.servers = (config.servers || []).filter(s => s.id !== serverId); saveConfig(); io.emit('server:removed', serverId); });
    socket.on('server:toggle', (serverId) => { const s = (config.servers || []).find(s => s.id === serverId); if (s) { s.enabled = !s.enabled; saveConfig(); io.emit('config', config); } });
    socket.on('bot:reconnect', (serverId) => io.emit('bot:reconnect', serverId));
    socket.on('message:add', (msg) => { config.messages = config.messages || []; config.messages.push(msg); saveConfig(); io.emit('config', config); });
    socket.on('message:remove', (i) => { config.messages = config.messages || []; config.messages.splice(i, 1); saveConfig(); io.emit('config', config); });
    socket.on('learning:get', () => { loadData(); socket.emit('learning:data', learningData); });
    socket.on('players:get', () => { loadData(); socket.emit('players:data', playersData); });
    socket.on('player:history', (username) => socket.emit('player:history', { username, history: playersData.players[username] }));
    
    socket.on('disconnect', () => console.log(`[RELAY] Desconectado: ${socket.id}`));
});

// API Routes
app.get('/api/status', (req, res) => res.json(botStatus));
app.get('/api/config', (req, res) => res.json(config));
app.post('/api/config', (req, res) => { config = { ...config, ...req.body }; saveConfig(); io.emit('config', config); res.json({ success: true }); });
app.get('/api/servers', (req, res) => res.json(config.servers || []));
app.get('/api/players', (req, res) => res.json(playersData));
app.get('/api/learning', (req, res) => res.json(learningData));
app.get('/api/logs', (req, res) => res.json(logs.slice(-100)));

function addLog(message, level = 'info', serverId = null) {
    logs.push({ timestamp: Date.now(), message, level, serverId });
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
}

server.listen(PORT, () => {
    console.log('========================================');
    console.log('  Minecraft Bot Relay V 1.3');
    console.log('========================================');
    console.log(`[SERVER] Porta: ${PORT}`);
    console.log(`[SERVER] Local: http://localhost:${PORT}`);
    if (config.relay?.externalUrl) console.log(`[SERVER] Externo: ${config.relay.externalUrl}`);
    console.log('========================================');
});

process.on('uncaughtException', (error) => console.error('[ERROR]', error));
process.on('unhandledRejection', (reason) => console.error('[ERROR]', reason));
