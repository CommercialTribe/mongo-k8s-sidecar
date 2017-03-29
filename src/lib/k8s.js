const Client = require('node-kubernetes-client');
const config = require('./config');
const fs = require('fs');

const readToken = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token');

const client = new Client({
  host: config.k8sROServiceAddress,
  namespace: config.namespace,
  protocol: 'https',
  version: 'v1',
  token: readToken
});

function getMongoPods(done) {
  client.pods.get((err, podResult) => {
    if (err) {
      return done(err);
    }
    let pods = [];
    for (const j in podResult) {
      pods = pods.concat(podResult[j].items)
    }
    const labels = config.mongoPodLabelCollection;
    const results = [];
    for (const i in pods) {
      const pod = pods[i];
      if (podContainsLabels(pod, labels)) {
        results.push(pod);
      }
    }

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
