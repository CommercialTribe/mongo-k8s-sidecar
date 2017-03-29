const winston = require('winston');

winston.level = process.env.LOG_LEVEL || 'error';

module.exports = winston
