'use strict';
var commonServer = require('norman-common-server');
var registry = commonServer.registry;
require('norman-server-tp');
var serviceLogger = commonServer.logging.createLogger('uicatalogmanager-server');
var serviceFactories = {
    UICatalog: require('./catalog')
};

var serviceInstances = {
};

function runOnServices(services, fnName, done, argObject) {
    var k, n, keys;
    keys = Object.keys(services);
    k = 0;
    n = keys.length;
    function nextService() {
        var key, service;
        if (k >= n) {
            return Promise.resolve(true);
        }
        key = keys[k++];
        service = services[key];
        serviceLogger.debug('Running ' + fnName + ' process on ' + key);
        if (typeof service[fnName] === 'function') {
            if (argObject) {
                return Promise.invoke(service, fnName, argObject).then(nextService);
            }
            else {
                return Promise.invoke(service, fnName).then(nextService);
            }
        }
        return nextService();
    }
    return nextService().callback(done);
}


module.exports = {
    initialize: function (done) {
        serviceLogger.debug('Initializing UICatalog services');
        Object.keys(serviceFactories).forEach(function (key) {
            serviceLogger.debug('Registering service ' + key);
            var service, ServiceClass = serviceFactories[key];
            service = new ServiceClass();
            serviceInstances[key] = service;
            registry.registerModule(service, key);
        });
        runOnServices(serviceInstances, 'initialize', done);
    },
    onInitialized: function (done) {
        serviceLogger.debug('UICatalog services onInitialized');
        runOnServices(serviceInstances, 'onInitialized', done);
    },
    checkSchema: function(done) {
        serviceLogger.debug('UICatalog services checkSchema');
        runOnServices(serviceInstances, 'checkSchema', done);
    },
    onSchemaChecked: function(done) {
        serviceLogger.debug('UICatalog services onSchemaChecked');
        runOnServices(serviceInstances, 'onSchemaChecked', done);
    },
    initializeSchema: function (done) {
        serviceLogger.debug('UICatalog services initializeSchema');
        runOnServices(serviceInstances, 'initializeSchema', done);
    },
    onSchemaInitialized: function (done) {
        serviceLogger.debug('UICatalog services onSchemaInitialized');
        runOnServices(serviceInstances, 'onSchemaInitialized', done);
    },
    prepareSchemaUpgrade: function (version,done) {
        serviceLogger.debug('UICatalog services prepareSchemaUpgrade');
        runOnServices(serviceInstances, 'prepareSchemaUpgrade', done, version);
    },
    upgradeSchema: function (version,done) {
        serviceLogger.debug('UICatalog services upgradeSchema');
        runOnServices(serviceInstances, 'upgradeSchema', done, version);
    },
    onSchemaUpgraded: function (version,done) {
        serviceLogger.debug('UICatalog services onSchemaUpgraded');
        runOnServices(serviceInstances, 'onSchemaUpgraded', done, version);
    },
    shutdown: function (done) {
        serviceLogger.info('Shutdown UICatalog services');
        runOnServices(serviceInstances, 'shutdown', done);
        serviceInstances = {};
    },
    services: serviceFactories
};
