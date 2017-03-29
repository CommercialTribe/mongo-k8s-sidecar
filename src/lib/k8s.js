const Client = require('node-kubernetes-client');
const { k8sNamespace, k8sServiceAccountToken, k8sROServiceAddress, mongoPodLabelCollection } = require('./config');
const logger = require('./logger');

const client = new Client({
	protocol: 'https',
  version: 'v1',
  host: k8sROServiceAddress,
  namespace: k8sNamespace,
  token: k8sServiceAccountToken
});

function getMongoPods(done) {
	logger.debug('Fetching mongo pods...')
  client.pods.get((err, podResult) => {
    if (err) return done(err);
    let pods = [];
    for (const j in podResult) {
      pods = pods.concat(podResult[j].items)
    }
    const labels = mongoPodLabelCollection;
    const results = [];
    for (const i in pods) {
      const pod = pods[i];
      if (podContainsLabels(pod, labels)) results.push(pod);
    }

		logger.debug(`Got pods:\n${results}`)

    done(null, results);
  });
}

function podContainsLabels(pod, labels) {
  if (!pod.metadata || !pod.metadata.labels) return false;

  for (const i in labels) {
    const kvp = labels[i];
    if (!pod.metadata.labels[kvp.key] || pod.metadata.labels[kvp.key] != kvp.value) {
      return false;
    }
  }

  return true;
}

module.exports = {
  getMongoPods
};
