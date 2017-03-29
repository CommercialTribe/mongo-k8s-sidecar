const dns = require('dns');
const fs = require('fs');
const logger = require('./logger');

function getMongoPodLabels() {
  return process.env.MONGO_SIDECAR_POD_LABELS || false;
}

function getMongoPodLabelCollection() {
  const podLabels = getMongoPodLabels();
  if (!podLabels) {
    return false;
  }
  const labels = process.env.MONGO_SIDECAR_POD_LABELS.split(',');
  for (const i in labels) {
    const keyAndValue = labels[i].split('=');
    labels[i] = {
      key: keyAndValue[0],
      value: keyAndValue[1]
    };
  }

  return labels;
}

function getk8sROServiceAddress() {
  return process.env.KUBERNETES_SERVICE_HOST + ":" + process.env.KUBERNETES_SERVICE_PORT
}

// @returns k8sClusterDomain should the name of the kubernetes domain where the cluster is running.
// Can be convigured via the environmental variable 'KUBERNETES_CLUSTER_DOMAIN'.
function getK8sClusterDomain() {
  const domain = process.env.KUBERNETES_CLUSTER_DOMAIN || "cluster.local";
  verifyCorrectnessOfDomain(domain);
  return domain;
}

// Calls a reverse DNS lookup to ensure that the given custom domain name matches the actual one.
// Raises a console warning if that is not the case.
// @param clusterDomain the domain to verify.
function verifyCorrectnessOfDomain(clusterDomain) {
	if(clusterDomain && dns.getServers() && dns.getServers().length > 0) {
		// In the case that we can resolve the DNS servers, we get the first and try to retrieve its host.
		dns.reverse(dns.getServers()[0], (err, host) => {
			if(err || host.length < 1 || !host[0].endsWith(clusterDomain)) {
				logger.warn("Possibly wrong cluster domain name! Detected '%s' but expected similar to: %s",  clusterDomain, host);
			} else {
				logger.info("The cluster domain '%s' was successfully verified.", clusterDomain)
			}
		});
	}
}

// @returns k8sMongoServiceName should be the name of the (headless) k8s service operating the mongo pods.
function getK8sMongoServiceName() {
  const service = process.env.KUBERENETES_SERVICE;
	if (service) {
		logger.info("Using service: %s", service);
		return service
	}
	throw "Missing environment variable: KUBERENETES_SERVICE"
}

// @returns mongoPort this is the port on which the mongo instances run. Default is 27017.
function getMongoDbPort() {
  const mongoPort = process.env.MONGO_PORT || 27017;
  logger.info("Using mongo port: %s", mongoPort);
  return mongoPort;
}

module.exports = {
	authenticatedMongo: process.env.MONGO_USER && process.env.MONGO_PASSWORD,
	mongoPort: getMongoDbPort(),
	mongoUser: process.env.MONGO_USER,
	mongoPassword: process.env.MONGO_PASSWORD,
  loopSleepSeconds: process.env.MONGO_SIDECAR_SLEEP_SECONDS || 5,
  unhealthySeconds: process.env.MONGO_SIDECAR_UNHEALTHY_SECONDS || 15,
  mongoPodLabelCollection: getMongoPodLabelCollection(),
	k8sNamespace: process.env.KUBERENETES_NAMESPACE,
  k8sROServiceAddress: getk8sROServiceAddress(),
  k8sMongoServiceName: getK8sMongoServiceName(),
  k8sClusterDomain: getK8sClusterDomain(),
	k8sServiceAccountToken: fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token'),
};
