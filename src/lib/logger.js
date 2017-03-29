const winston = require('winston');

winston.level = process.env.LOG_LEVEL || 'info';

module.exports = winston
