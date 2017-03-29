const { Db, Server } = require('mongodb');
const async = require('async');
const { mongoPort, mongoPassword, mongoUser, authenticatedMongo } = require('./config');
const logger = require('./logger');

const localhost = '127.0.0.1'; // Can access mongo as localhost from a sidecar

function getDb(host, done) {
	// If they called without host like getDb(function(err, db) { ... });
	if (arguments.length === 1) {
		if (typeof arguments[0] === 'function') {
			done = arguments[0];
			host = localhost;
		} else {
			throw new Error('getDb illegal invocation. User either getDb(\'hostAddr\', function(err, db) { ... }) OR getDb(function(err, db) { ... })');
		}
	}
  host = host || localhost;
  const db = new Db('local', new Server(host, mongoPort));
  db.open((err, db) => {
    if (err) return done(err);
		if (authenticatedMongo){
			db.authenticate(mongoUser, mongoPassword, err => {
				if (err) return done(err);
				done(null, db);
			})
		} else {
			done(null, db);
		}
  });
}

function replSetGetConfig(db, done) {
  db.admin().command({ replSetGetConfig: 1 }, {}, (err, results) => {
    if (err) return done(err);
    done(null, results.config);
  });
}

function replSetGetStatus(db, done) {
  db.admin().command({ replSetGetStatus: {} }, {}, (err, results) => {
    if (err) return done(err);
    done(null, results);
  });
}

function initReplSet(db, hostIpAndPort, done) {
  logger.debug('initReplSet', hostIpAndPort);

  db.admin().command({ replSetInitiate: {} }, {}, err => {
    if (err) return done(err);

    // We need to hack in the fix where the host is set to the hostname which isn't reachable from other hosts
    replSetGetConfig(db, (err, config) => {
      if (err) return done(err);
      config.members[0].host = hostIpAndPort;
      async.retry({ times: 20, interval: 500 }, callback => {
        replSetReconfig(db, config, false, callback);
      }, err => {
        if (err) return done(err);
        done();
      });
    });
  });
}

function replSetReconfig(db, config, force, done) {
  logger.debug('replSetReconfig', config);

  config.version++;

  db.admin().command({ replSetReconfig: config, force: force }, {}, (err) => {
    if (err) return done(err);
    done();
  });
}

function addNewReplSetMembers(db, addrToAdd, addrToRemove, shouldForce, done) {
  replSetGetConfig(db, (err, config) => {
    if (err) return done(err);

    addNewMembers(config, addrToAdd);
    removeDeadMembers(config, addrToRemove);
    replSetReconfig(db, config, shouldForce, done);
  });
}

function addNewMembers(config, addrsToAdd) {
  if (!addrsToAdd || !addrsToAdd.length) return;

  // Follows what is basically in mongo's rs.add function
  let max = 0;

  for (const j in config.members) {
    if (config.members[j]._id > max) {
      max = config.members[j]._id;
    }
  }

  for (const i in addrsToAdd) {
    const cfg = { _id: ++max, host: addrsToAdd[i] };
    config.members.push(cfg);
  }
}

function removeDeadMembers(config, addrsToRemove) {
  if (!addrsToRemove || !addrsToRemove.length) return;

  for (const i in addrsToRemove) {
    const addrToRemove = addrsToRemove[i];
    for (const j in config.members) {
      const member = config.members[j];
      if (member.host === addrToRemove) {
        config.members.splice(j, 1);
        break;
      }
    }
  }
}

function isInReplSet(ip, done) {
  getDb(ip, (err, db) => {
    if (err) return done(err);

    replSetGetConfig(db, (err, config) => {
      db.close();
      if (!err && config) {
        done(null, true);
      } else {
        done(null, false);
      }
    });
  });
}

module.exports = {
  getDb,
  replSetGetStatus,
  initReplSet,
  addNewReplSetMembers,
  isInReplSet
};
