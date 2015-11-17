import express from 'express';
var cookieParser = require('cookie-parser')
import http from 'http';

import logger from './logger';
import socket from './socket';

const app = express();
const server = http.createServer(app);

app.use(cookieParser());

socket(server);

server.listen(3000, () => {
  logger.warn('server started...');
});
