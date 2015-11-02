require('babel/register')({
    optional: ['es7.asyncFunctions'],
});

global.Promise = require('bluebird');

require('./src/server');

