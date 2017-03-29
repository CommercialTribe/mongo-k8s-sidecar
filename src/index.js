const logger = require('./lib/logger');
const { init, workloop } = require('./lib/worker');

logger.info('Starting up mongo-k8s-sidecar');

init(
	err => err ? logger.log('error', 'Error trying to initialize mongo-k8s-sidecar', err) : workloop()
);
