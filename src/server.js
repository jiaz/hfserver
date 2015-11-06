import io from 'socket.io';
import ss from 'socket.io-stream';
import progress from 'progress-stream';
import http from 'http';

import logger from './logger';

const server = http.createServer();
const ioserver = io(server);

const clientMap = new WeakMap();
const pendingRequests = {};

let requestId = 0;

class Request {
    constructor() {
        this.id = requestId++;
        this.srcFile = null;
        this.dstFile = null;
        this.fileSize = null;
        this.srcClient = null;
        this.dstClient = null;
    }
}

function registerHandler(socket, cmd, args, cb) {
    logger.info('get a name: ' + args.name);
    clientMap.set(socket, args.name);
    cb(null, 'welcome to the hfserver!');
}

function lsHandler(socket, cmd, args, cb) {
    let clientNames = [];
    ioserver.sockets.sockets.forEach((socket) => {
        clientNames.push(clientMap.get(socket));
    });
    cb(null, clientNames);
}

function sendHandler(socket, cmd, args, cb) {
    let [user, file, fileSize] = args;
    let userSocket = null;
    ioserver.sockets.sockets.forEach((socket) => {
        if (clientMap.get(socket) === user) {
            userSocket = socket;
        }
    });
    if (userSocket === null) {
        cb(null, 'no such user.');
    } else {
        let req = new Request();
        req.srcFile = file;
        req.fileSize = fileSize;
        req.srcClient = socket;
        req.dstClient = userSocket;
        pendingRequests[req.id] = req;
        userSocket.emit('request_file', {file, id: req.id});
        cb(null, 'request sent.');
    }
}

var cmdHandler = {
    'ls': lsHandler,
    'send': sendHandler,
    'register': registerHandler
};

function processCommand(socket, cmd, args, callback) {
    let result = 'not supported!';
    let handler = cmdHandler[cmd];
    if (handler) {
        handler(socket, cmd, args, callback);
    } else {
        callback(null, 'unknown cmd.');
    }
}

ioserver.on('connection', (socket) => {
    let ssclient = null;
    logger.info('a user connected!');
    ssclient = ss(socket);
    ssclient.on('file_data', (readStream, data) => {
        logger.info('piping data...');
        let req = pendingRequests[data.id];
        let pgStream = progress({
            length: req.fileSize,
            time: 1000
        });
        let writeStream = ss.createStream();
        ss(req.dstClient).emit('receive_file',
            writeStream,
            {file: req.dstFile, id: req.id});
        pgStream.on('progress', p => {
            logger.info('progress: ' + JSON.stringify(pgStream.progress()));
            req.dstClient.emit('progress', {percentage: p.percentage});
            req.srcClient.emit('progress', {percentage: p.percentage});
        });
        readStream.pipe(pgStream).pipe(writeStream);
    });

    socket.emit('hello', {message: 'please enter your name: '});

    socket.on('disconnect', function() {
        logger.info('user disconnected.');
    });

    socket.on('cmd', (data) => {
        logger.info(`get a cmd: ${data.cmd} [${data.seqId}] with args ${data.args}`);
        processCommand(socket, data.cmd, data.args, (err, res) => {
            socket.emit('ready', {seqId: data.seqId, error: err, response: res});
        });
    });

    socket.on('accept', (data) => {
        logger.info('accepted, save to: ' + data.file);
        let id = data.id;
        let req = pendingRequests[id];
        req.dstFile = data.file;
        req.srcClient.emit('send_file', {file:req.srcFile, id:id});
    });

    socket.on('receive_done', (data) => {
        let req = pendingRequests[data.id];
        req.dstClient.emit('ready', {message:'transfer finished!'});
        req.srcClient.emit('ready', {message:'transfer finished!'});
        delete pendingRequests[data.id];
    });

    socket.on('deny', (data) => {
        logger.info('denied.');
        socket.emit('ready', {message: 'request denied.'});
        pendingRequests[data.id].srcClient.emit('ready', {message: 'request denied.'});
        delete pendingRequests[data.id];
    });
});

server.listen(3000, () => {
    logger.warn('server started...');
});
