const express = require('express');
const app = express();
const http = require('http');
const port = process.env.PORT || 5000;
const hostname = process.env.HOSTNAME || 'localhost';
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    maxHttpBufferSize: 5e7 // 50 MB
});
const UAParser = require('ua-parser-js');
const { randomUUID } = require("crypto");
const db = new Map();

app.get('/favicon.ico', function(req, res) { res.sendFile(__dirname + "/public/favicon.ico"); });
app.get('/style.css', function(req, res) { res.sendFile(__dirname + "/public/style.css"); });
app.get('/logo.svg', function(req, res) { res.sendFile(__dirname + "/public/logo.svg"); });
app.get('/MonaspaceNeon-Bold.woff2', function(req, res) { res.sendFile(__dirname + "/public/MonaspaceNeon-Bold.woff2"); });
app.get('/', (req, res) => { res.sendFile(__dirname + '/public/index.html'); });

io.on('connection', (socket) => {
    const ipAddress = isProductionEnv() ? extractIpAddress(socket) : 'local';
    socket.join(ipAddress);
    const device = getDeviceName(socket.request.headers['user-agent']);
    socket.device = device;

    console.log(`[${device}] user connected (${ipAddress})`);
    const usersInRoom = Array.from(io.sockets.adapter.rooms.get(ipAddress))
        .map(clientId => {
            return {
                id: clientId,
                device: io.sockets.sockets.get(clientId).device,
            }
        });
    const data = {
        room: ipAddress,
        usersInRoom,
        sharedContents: Database.get(ipAddress)
    };
    io.to(ipAddress).emit('connected', data);

    socket.on('message', (msg) => {
        console.log(`[${device}] message: ${msg}`);
        const messageToAdd = {
            id: randomUUID(),
            content: msg,
            author: {
                id: socket.id,
                device: device,
            },
        };

        Database.addText(ipAddress, messageToAdd);
        const texts = Database.get(ipAddress).texts;
        io.to(ipAddress).emit('message', texts);
    });

    socket.on("upload", (file) => {
        const base64 = Buffer.from(file.content).toString('base64');
        const fileToAdd = {
            id: randomUUID(),
            name: file.name,
            type: file.type,
            author: {
                id: socket.id,
                device: device,
            },
            base64,
        };
        Database.addFile(ipAddress, fileToAdd);
        const files = Database.get(ipAddress).files;
        io.to(ipAddress).emit("refreshFiles", files);
    });

    socket.on('delete', (id) => {
        Database.deleteFileOrText(ipAddress, id);
        io.to(ipAddress).emit("deleteContent", id);
    });

    socket.on('disconnect', () => {
        io.to(ipAddress).emit('disconnected', socket.id);
        console.log(`[${device}] user disconnected (${ipAddress})`);
        // erase data from map if this is the last user in the room
        if (!io.sockets.adapter.rooms.get(ipAddress)) {
            Database.delete(ipAddress);
        }
    });
});

server.listen(port, hostname, () => {
    console.log(`Paste-it (production=${isProductionEnv()}, NODE_ENV=${process.env.NODE_ENV}) listening on ${hostname}:${port}`)
});

const getDeviceName = (uaHeader) => {
    let parser = new UAParser(uaHeader);
    let parserResults = parser.getResult();
    if (parserResults.device.model) {
        return parserResults.device.model;
    }
    if (parserResults.device.vendor) {
        return parserResults.device.vendor;
    }
    if (parserResults.os.name) {
        return parserResults.os.name;
    }
};

const isProductionEnv = () => {
    return process.env.NODE_ENV === 'production';
};
const extractIpAddress = (socket) => {
    if (socket.handshake.headers["x-forwarded-for"]) {
        return socket.handshake.headers["x-forwarded-for"].split(",")[0];
    }
    return socket.handshake.address;
}

class Database {
    static get(ipAddress) {
        return db.get(ipAddress);
    };
    static addFile(ipAddress, file) {
        if (!db.has(ipAddress)) {
            db.set(ipAddress, { texts: [], files: [file] });
            return;
        }
        const data = Database.get(ipAddress);
        data.files.push(file);
        db.set(ipAddress, data);
    };
    static addText(ipAddress, text) {
        if (!db.has(ipAddress)) {
            db.set(ipAddress, { texts: [text], files: [] });
            return;
        }
        const data = Database.get(ipAddress);
        data.texts.push(text);
        db.set(ipAddress, data);
    }
    static deleteFileOrText(ipAddress, id) {
        if (!db.has(ipAddress)) {
            return;
        }
        const data = Database.get(ipAddress);
        data.texts = data.texts.filter(text => text.id !== id);
        data.files = data.files.filter(file => file.id !== id);
        db.set(ipAddress, data);
    };
    static delete(ipAddress) {
        return db.delete(ipAddress);
    };
}
