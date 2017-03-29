const ip = require('ip');
const async = require('async');
const moment = require('moment');
const dns = require('dns');
const os = require('os');
const logger = require("./logger")
const mongo = require('./mongo');
const k8s = require('./k8s');
const config = require('./config');

const loopSleepSeconds = config.loopSleepSeconds;
const unhealthySeconds = config.unhealthySeconds;

let hostIp = false;
let hostIpAndPort = false;

function init(done) {
  // Borrowed from here: http://stackoverflow.com/questions/3653065/get-local-ip-address-in-node-js
  const hostName = os.hostname();
  dns.lookup(hostName, (err, addr) => {
    if (err) {
      return done(err);
    }

    hostIp = addr;
    hostIpAndPort = hostIp + ':' + config.mongoPort;

    done();
  });
}

function workloop() {
  if (!hostIp || !hostIpAndPort) {
    throw new Error('Must initialize with the host machine\'s addr');
  }

  // Do in series so if k8s.getMongoPods fails, it doesn't open a db connection
  async.series([ k8s.getMongoPods, mongo.getDb ], (err, results) => {
    let db = null;
    if (err) {
      if (Array.isArray(results) && results.length === 2) db = results[1];
      return finish(err, db);
    }

    const pods = results[0];
    db = results[1];

    // Lets remove any pods that aren't running
    for (let i = pods.length - 1; i >= 0; i--) {
      const pod = pods[i];
      if (pod.status.phase !== 'Running') {
        pods.splice(i, 1);
      }
    }

    if (!pods.length) {
      return finish(new Error('No pods are currently running, probably just give them some time.'));
    }

    // Lets try and get the rs status for this mongo instance
    // If it works with no errors, they are in the rs
    // If we get a specific error, it means they aren't in the rs
    mongo.replSetGetStatus(db, (err, status) => {
      if (err) {
        if (err.code && err.code == 94) {
          notInReplicaSet(db, pods, err => finish(err, db))
        } else if (err.code && err.code == 93) {
          invalidReplicaSet(db, pods, err => finish(err, db));
        } else {
          finish(err, db);
        }
        return;
      }

      inReplicaSet(db, pods, status, err => finish(err, db))
    });
  });
}

function finish(err, db) {
  if (err) logger.error('Error in workloop', err);
  if (db && db.close) db.close();
  setTimeout(workloop, loopSleepSeconds * 1000);
}

function inReplicaSet(db, pods, status, done) {
  // If we're already in a rs and we ARE the primary, do the work of the primary instance (i.e. adding others)
  // If we're already in a rs and we ARE NOT the primary, just continue, nothing to do
  // If we're already in a rs and NO ONE is a primary, elect someone to do the work for a primary
  const members = status.members;

  let primaryExists = false;
  for (const i in members) {
    const member = members[i];

    if (member.state === 1) {
      if (member.self) {
        return primaryWork(db, pods, members, false, done);
      }

      primaryExists = true;
      break;
    }
  }

  if (!primaryExists && podElection(pods)) {
    logger.info('Pod has been elected as a secondary to do primary work');
    return primaryWork(db, pods, members, true, done);
  }

  done();
}

function primaryWork(db, pods, members, shouldForce, done) {
  // Loop over all the pods we have and see if any of them aren't in the current rs members array
  // If they aren't in there, add them
  const addrToAdd = addrToAddLoop(pods, members);

  //Separate loop for removing members
  const addrToRemove = [];
  for (const i  in members) {
    const member = members[i];
    if (memberShouldBeRemoved(member)) {
      addrToRemove.push(member.name);
    }
  }

  if (addrToAdd.length || addrToRemove.length) {
    logger.debug('Addresses to add:   ', addrToAdd);
    logger.debug('Addresses to remove:', addrToRemove);

    mongo.addNewReplSetMembers(db, addrToAdd, addrToRemove, shouldForce, done);
    return;
  }

  done();
}

function memberShouldBeRemoved(member) {
  return !member.health
    && moment().subtract(unhealthySeconds, 'seconds').isAfter(member.lastHeartbeatRecv);
}

function notInReplicaSet(db, pods, done) {
  function createTestRequest(pod) {
    return function(completed) {
      mongo.isInReplSet(pod.status.podIP, completed);
    };
  }

  // If we're not in a rs and others ARE in the rs, just continue, another path will ensure we will get added
  // If we're not in a rs and no one else is in a rs, elect one to kick things off
  const testRequests = [];
  for (const i in pods) {
    const pod = pods[i];

    if (pod.status.phase === 'Running') {
      testRequests.push(createTestRequest(pod));
    }
  }

  async.parallel(testRequests, (err, results) => {
    if (err) {
      return done(err);
    }

    for (const i in results) {
      if (results[i]) {
        return done(); // There's one in a rs, nothing to do
      }
    }

    if (podElection(pods)) {
      logger.info('Pod has been elected for replica set initialization');
      const primary = pods[0]; // After the sort election, the 0-th pod should be the primary.
      const primaryStableNetworkAddressAndPort = getPodStableNetworkAddressAndPort(primary);
      // Prefer the stable network ID over the pod IP, if present.
      const primaryAddressAndPort = primaryStableNetworkAddressAndPort ? primaryStableNetworkAddressAndPort : hostIpAndPort;
      mongo.initReplSet(db, primaryAddressAndPort, done);
      return;
    }

    done();
  });
}

function invalidReplicaSet(db, pods, done) {
  // The replica set config has become invalid, probably due to catastrophic errors like all nodes going down
  // this will force re-initialize the replica set on this node. There is a small chance for data loss here
  // because it is forcing a reconfigure, but chances are recovering from the invalid state is more important
  logger.warn("Invalid set, re-initializing");
  const addrToAdd = addrToAddLoop(pods, []);
  mongo.addNewReplSetMembers(db, addrToAdd, [], true, (err) => {
    done(err, db);
  });
}

function podElection(pods) {
  //Because all the pods are going to be running this code independently, we need a way to consistently find the same
  //node to kick things off, the easiest way to do that is convert their ips into longs and find the highest
  pods.sort((a,b) => {
    const aIpVal = ip.toLong(a.status.podIP);
    const bIpVal = ip.toLong(b.status.podIP);
    if (aIpVal < bIpVal) return -1;
    if (aIpVal > bIpVal) return 1;
    return 0; //Shouldn't get here... all pods should have different ips
  });

  //Are we the lucky one?
  return pods[0].status.podIP == hostIp;
}

function addrToAddLoop(pods, members) {
  const addrToAdd = [];
  for (const i in pods) {
    const pod = pods[i];
    if (pod.status.phase !== 'Running') {
      continue;
    }

    const podIpAddr = getPodIpAddressAndPort(pod);
    const podStableNetworkAdd = getPodStableNetworkAddressAndPort(pod);
    let podInRs = false;

    for (const j in members) {
      const member = members[j];
      if ((podIpAddr && member.name === podIpAddr) || (podStableNetworkAdd && member.name === podStableNetworkAdd)) {
        /* If we have the pod's ip or the stable network address already in the config, no need to read it. Checks both the pod IP and the
        * stable network ID - we don't want any duplicates - either one of the two is sufficient to consider the node present. */
        podInRs = true;
        continue;
      }
    }

    if (!podInRs) {
      // If the node was not present, we prefer the stable network ID, if present.
      const addrToUse = podStableNetworkAdd ? podStableNetworkAdd : podIpAddr;
      addrToAdd.push(addrToUse);
    }
  }
  return addrToAdd;
}


// @param pod this is the Kubernetes pod, containing the info.
// @returns podIp the pod's IP address with the default port of 27017 (retrieved from the config) attached at the end. Example
// WWW.XXX.YYY.ZZZ:27017. It returns undefined, if the data is insufficient to retrieve the IP address.
function getPodIpAddressAndPort(pod) {
  let podIpAddress = undefined;
  if (pod && pod.status && pod.status.podIP) {
    podIpAddress = pod.status.podIP + ":" + config.mongoPort;
  }
  return podIpAddress;
}

// Gets the pod's address. It can be either in the form of
// '<pod-name>.<mongo-kubernetes-service>.<pod-namespace>.svc.cluster.local:<mongo-port>'. See:
// <a href="https://kubernetes.io/docs/concepts/abstractions/controllers/statefulsets/#stable-network-id">Stateful Set documentation</a>
// for more details. If those are not set, then simply the pod's IP is returned.
// @param pod the Kubernetes pod, containing the information from the k8s client.
// @returns stableNetworkAddress the k8s MongoDB stable network address, or undefined.
function getPodStableNetworkAddressAndPort(pod) {
  let podStableNetworkAddress = undefined;
  if (config.k8sMongoServiceName && pod && pod.metadata && pod.metadata.name && pod.metadata.namespace) {
    const clusterDomain = config.k8sClusterDomain;
    const mongoPort = config.mongoPort;
    podStableNetworkAddress = pod.metadata.name + "." + config.k8sMongoServiceName + "." + pod.metadata.namespace + ".svc." +
      clusterDomain + ":" + mongoPort;
  }
  return podStableNetworkAddress;
}

module.exports = {
  init,
  workloop
};
