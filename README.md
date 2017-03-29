# Mongo Kubernetes StatefulSet Set Sidecar

This project is as a PoC to setup a mongo replica set using Kubernetes. It should handle resizing of any type and be
resilient to the various conditions both mongo and kubernetes can find themselves in.

## How to use it

The docker image is hosted on docker hub and can be found here:  
https://hub.docker.com/r/commercialtribe/mongo-k8s-sidecar/

There you will also find some helper scripts to test out creating the replica set and resizing it.

### Settings

- KUBERENETES_NAMESPACE  
  Required: NO  
  The namespace to look up pods in. Not setting it will search for pods in all namespaces.
- MONGO_SIDECAR_POD_LABELS  
  Required: YES  
  This should be a be a comma separated list of key values the same as the podTemplate labels. See above for example.
- MONGO_SIDECAR_SLEEP_SECONDS  
  Required: NO  
  Default: 5  
  This is how long to sleep between work cycles.
- MONGO_SIDECAR_UNHEALTHY_SECONDS  
  Required: NO  
  Default: 15  
  This is how many seconds a replica set member has to get healthy before automatically being removed from the replica set.
- MONGO_PORT
  Required: NO
  Default: 27017
  Configures the mongo port, allows the usage of non-standard ports.  
- KUBERENETES_SERVICE  
  Required: NO  
  This should point to the MongoDB Kubernetes (headless) service that identifies all the pods. It is used for setting up the
  DNS configuration for the mongo pods, instead of the default pod IPs. Works only with the StatefulSets' stable network ID.  
- KUBERENETES_CLUSTER_DOMAIN
  Required: NO  
  Default: cluster.local  
  This allows the specification of a custom cluster domain name. Used for the creation of a stable network ID of the k8s Mongo
  pods. An example could be: "kube.local".  

Make sure that you have the `KUBERNETES_MONGO_SERVICE_NAME`
environmental variable set. Then the MongoDB replica set node names could look like this:
```
[ { _id: 1,
   name: 'mongo-prod-0.mongodb.db-namespace.svc.cluster.local:27017',
   stateStr: 'PRIMARY',
   ...},
 { _id: 2,
   name: 'mongo-prod-1.mongodb.db-namespace.svc.cluster.local:27017',
   stateStr: 'SECONDARY',
   ...},
 { _id: 3,
   name: 'mongo-prod-2.mongodb.db-namespace.svc.cluster.local:27017',
   stateStr: 'SECONDARY',
   ...} ]
```
StatefulSet name: `mongo-prod`.  
Headless service name: `mongodb`.  
Namespace: `db-namespace`.

Read more about the stable network IDs
<a href="https://kubernetes.io/docs/concepts/abstractions/controllers/statefulsets/#stable-network-id">here</a>.

An example for a stable network pod ID looks like this:
`$(statefulset name)-$(ordinal).$(service name).$(namespace).svc.cluster.local`.
The `statefulset name` + the `ordinal` form the pod name, the `service name` is passed via `KUBERNETES_MONGO_SERVICE_NAME`,
the namespace is extracted from the pod metadata and the rest is static.

A thing to consider when running a cluster with the mongo-k8s-sidecar is that it will prefer the stateful set stable
network ID to the pod IP. It is however compatible with replica sets, configured with the pod IP as identifier - the sidecar
should not add an additional entry for it, nor alter the existing entries. The mongo-k8s-sidecar should only use the stable
network ID for new entries in the cluster.

Example of compatible mongo replica names:
```
mongo-prod-0.mongodb.db-namespace.svc.cluster.local:27017 # Uses the stable network ID
```

If you run the sidecar alongside such a cluster, it may lead to a broken replica set, so make sure to test it well before
going to production with it (which applies for all software).
