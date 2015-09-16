/* eslint  no-unused-vars: 0 */
'use strict';
var commonServer = require('norman-common-server');
var JSZip = require('jszip');
var logger = commonServer.logging.createLogger('uicatalogmanager-service');
var ObjectId = commonServer.db.mongoose.Types.ObjectId;
require('norman-server-tp');
var model = require('./grid.model'),
    tp = require('norman-server-tp'),
    NormanError = commonServer.NormanError,
    stream = tp.streamifier,
    os = require('os'),
    commonService = require('./../common/common.service.js'),
    restrictFields = '_id length metadata.updated_at metadata.created_at metadata.contentType metadata.extension filename metadata.length',
    GridModel,
    path = require('path'),
    fs = require('fs'),
    mime = tp.mime,
    zip = new JSZip(),
    _ = tp.lodash,
    smartTemplateHelper = require('./helpers/smartTemplateCatalogHelper.js');


var serviceLogger = commonServer.logging.createLogger('uicatalog-service');

var OPEN_CSS_LIBRARIES = ['sap/ui/core', 'sap/ui/layout', 'sap/ui/commons', 'sap/m', 'sap/ui/unified'];
var OPEN_JS_LIBRARIES = ['sap/ui/core', 'sap/ui/layout', 'sap/ui/commons', 'sap/m', 'sap/ui/unified'];
var OPEM_CSS_FILE_NAME = 'sap-ui-merged-libraries.css';
var OPEM_JS_FILE_NAME = 'sap-ui-core-preloaded.js';
var OPEM_THIRD_PART_FILE_NAMES = [
    'sap/ui/thirdparty/signals.js',
    'sap/ui/thirdparty/crossroads.js',
    'sap/ui/thirdparty/hasher.js',
    'sap/ui/thirdparty/datajs.js',
    'sap/ui/thirdparty/sinon.js'
];

var SMART_CSS_LIBRARIES = ['sap/ui/core', 'sap/ui/layout', 'sap/ui/commons', 'sap/m', 'sap/ushell', 'sap/ui/unified', 'sap/ui/comp', 'sap/ui/generic/template', 'sap/suite/ui/generic/template', 'sap/uxap', 'sap/ui/table'];
var SMART_JS_LIBRARIES = ['sap/ui/core', 'sap/ui/layout', 'sap/ui/commons', 'sap/m', 'sap/ushell','sap/ui/unified', 'sap/ui/fl', 'sap/ui/comp', 'sap/ui/generic/app', 'sap/ui/generic/template', 'sap/suite/ui/generic/template', 'sap/uxap', 'sap/ui/table'];
var SMART_CSS_FILE_NAME = 'sap-ui-st-merged-libraries.css';
var SMART_JS_FILE_NAME = 'sap-ui-core-st-preloaded.js';
var SMART_THIRD_PART_FILE_NAMES = [
    'sap/ui/thirdparty/signals.js',
    'sap/ui/thirdparty/crossroads.js',
    'sap/ui/thirdparty/hasher.js',
    'sap/ui/thirdparty/datajs.js',
    'sap/ui/thirdparty/sinon.js',
    'sap/ui/comp/smarttable/SmartTableRenderer.js'
];

/*============================COMMON FUNCTIONS============================*/

/**
 * UICatalogService UI Catalog service
 * @model {Object}
 */
function UICatalogService(model) {
    if (!(this instanceof UICatalogService)) {
        return new UICatalogService(model);
    }

    this.model = model || require('./model.js');
}

module.exports = UICatalogService;

UICatalogService.prototype.initialize = function(done) {
    GridModel = model.create();
    done();
};

UICatalogService.prototype.checkSchema = function(done) {
    model.createIndexes(done);
};

UICatalogService.prototype.initializeSchema = function(done) {
    var promises = [];
    var self = this;
    promises.push(Promise.resolve(self.initializeDb()));
    promises.push(self.initializeLibrary());
    promises.push(Promise.resolve(self.extractLibrary()));

    Promise.waitAll(promises)
        .catch(function(err) {
            var error = new NormanError('Failed to initialize Schema', err);
            serviceLogger.error(error);
            throw error;
        })
        .callback(done);
};

/**
 * Shutdown once the service is shutdown centrally
 * @param done
 */
UICatalogService.prototype.shutdown = function(done) {
    serviceLogger.info('>> shutdown()');
    model.destroy(done);
};

/**
 * getGridModel handler for fetching grid model
 * @return {Object}
 */
function getGridModel() {
    if (!GridModel) {
        GridModel = model.create();
    }
    return GridModel;
}

/*============================CATALOG============================*/

/**
 * upload handler for catalog upload
 * @catalog  {Object}
 * @return {Object}
 */
UICatalogService.prototype.upload = function(catalog) {
    var deferred = Promise.defer();
    UICatalogService.prototype.createCatalog(catalog);
    return deferred.promise;
};
/**
 * getSampleTemplates handler for listing catalogs
 * @return {Object}
 */
UICatalogService.prototype.getSampleTemplates = function() {
    var deferred = Promise.defer();
    this.model.find({}, {
        _id: 0,
        __v: 0
    }, function(err, catalogs) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(catalogs);
        }
    });

    return deferred.promise;
};
/**
 * updateCustomCatalog handler for catalog update
 * @catalog  {Object}
 * @return {Object}
 */
UICatalogService.prototype.updateCustomCatalog = function(catalog) {
    var deferred = Promise.defer();
    this.model.findOneAndUpdate({
        $and: [{
                catalogName: catalog.catalogName
            }, {
                catalogVersion: catalog.catalogVersion
            }, {
                rootCatalogId: catalog.rootCatalogId
            }]
            // }, catalog, {
    }, catalog, {
        upsert: true
    }, function(err, ctlog) {
        if (err) {
            //console.log('Error in finding catalog:' + err);
            deferred.reject(err);
        } else {
            if (ctlog) {
                deferred.resolve(ctlog);
            } else {
                deferred.reject('Catalog not found');
            }
        }
    });
    return deferred.promise;
};

/**
 * Returns all available libraries and versions of all libraries.
 *
 * @returns {Object} with type and version keys of available libraries
 */

UICatalogService.prototype.getAllLibrariesAndVersions = function () {
    var self = this;
    var libTypesAndVersions = [];

    return this.getCatalogs('root')
        .then(function (libtypes) {
            var libtypesAndVersionsPromises = [];
            _.map(libtypes, function (libType) {
                libtypesAndVersionsPromises.push(self.getAvailableVersions(libType.catalogLang).then(function (libVersions) {
                    _.map(libVersions, function (libVersion) {
                        libTypesAndVersions.push({
                            'type': libType.catalogLang,
                            'version': libVersion._id
                        });
                    });
                }));
            });
            return Promise.all(libtypesAndVersionsPromises);
        }).then(function () {
            return libTypesAndVersions;
        });
};

/**
 * getCatalogs handler for listing catalogs
 * @return {Object}
 */
UICatalogService.prototype.getCatalogs = function(filter) {
    var deferred = Promise.defer();

    var conditions, fields;
    var self = this;
    conditions = {};
    fields = {
        _id: 1,
        catalogId: 1,
        catalogName: 1,
        catalogVersion: 1,
        displayName: 1,
        catalogLang: 1,
        isRootCatalog: 1
    };
    switch (filter) {
        case 'none':
            conditions = {};
            break;
        case 'root':
            conditions = {
                'isRootCatalog': true
            };
            break;
        case 'custom':
            conditions = {
                'isRootCatalog': false
            };
            break;
        case 'default':
            conditions = {
                '$and': [{
                    'isDefault': true
                }, {
                    'floorPlans': {
                        '$exists': true
                    }
                }]
            };
            break;
        case 'floorplan':
            conditions = {
                '$and': [{
                    'isRootCatalog': false
                }, {
                    'floorPlans': {
                        '$exists': true
                    }
                }]
            };
            break;
    }

    this.model.find(conditions, fields).lean().exec(
        function(err, catalogs) {
            if (err) {
                serviceLogger.error(new NormanError(err));
                return deferred.reject(err);
            } else {
                deferred.resolve(self.addCatalogId(catalogs));
            }
        });

    return deferred.promise;
};

UICatalogService.prototype.addCatalogId = function(catalogs) {
    if (catalogs instanceof Array) {
        var newArray = [];
        for (var itr = 0; itr < catalogs.length; itr++) {
            var catalog = catalogs[itr];
            catalog.catalogId = catalog._id;
            delete catalog._id;
            newArray.push(catalog);
        }
        return newArray;
    } else {
        catalogs.catalogId = catalogs._id;
        delete catalogs._id;
        return catalogs;
    }
};

/**
 * deleteCatalog handler for deleting catalog
 * @name  {String}
 * @catalogVersion  {String}
 * @return {Object}
 */
UICatalogService.prototype.deleteCatalog = function(name, catalogVersion) {
    var deferred = Promise.defer();
    var conditions;
    conditions = {
        catalogName: name,
        catalogVersion: catalogVersion
    };
    this.model.find().remove(conditions,
        function(err, catalogs) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(catalogs);
            }
        });

    return deferred.promise;
};

/**
 * createCatalog handler for catalog create
 * @catalog  {Object}
 * @return {Object}
 */
UICatalogService.prototype.createCatalog = function(catalog) {
    var model = this.model,
        deferred = Promise.defer(),
        catalogName = catalog.catalogName,
        catalogVersion = catalog.catalogVersion;

    this.model.find({
        name: catalogName,
        catalogVersion: catalogVersion
    }, {}, function(err, catalogs) {
        if (err) {
            deferred.reject(err);
        } else {
            if (catalogs.length === 0) {
                // create the catalog,only if the catalog with the specified name and version doesnot exist
                model.create(catalog, function(error, ctlog) {
                    if (error) {
                        deferred.reject(error);
                    } else {
                        deferred.resolve(ctlog);
                    }
                });
            } else {
                deferred.resolve(catalog);
            }
        }
    });
    return deferred.promise;
};

/**
 * updateCatalog handler for catalog update
 * @catalog  {Object}
 * @return {Object}
 */
UICatalogService.prototype.updateCatalog = function(catalog) {
    var deferred = Promise.defer();
    this.model.findOneAndUpdate({
        $and: [{
                catalogName: catalog.catalogName
            }, {
                catalogVersion: catalog.catalogVersion
            }]
            // }, catalog, {
    }, catalog, {
        upsert: true
    }, function(err, ctlog) {
        if (err) {
            //console.log('Error in finding catalog:' + err);
            deferred.reject(err);
        } else {
            if (ctlog) {
                deferred.resolve(ctlog);
            } else {
                deferred.reject('Catalog not found');
            }
        }
    });
    return deferred.promise;
};

UICatalogService.prototype.getCatalog = function(name, catalogVersion) {
    var deferred = Promise.defer();
    var condition = {
        catalogName: name,
        catalogVersion: catalogVersion
    };
    var fields = {};
    var self = this;
    this.model.findOne(condition, fields).lean().exec(function(err, catalogs) {
        if (err) {
            deferred.reject(err);
        } else {
            if (catalogs) {
                deferred.resolve(self.addCatalogId(catalogs));
            } else {
                serviceLogger.error(new NormanError('Catalog not found'));
                return deferred.reject('Catalog not found');
            }
        }
    });
    return deferred.promise;
};


/*============================ACTIONS============================*/

/**
 * getActions handler for fetching actions
 * @name  {String}
 * @return {Object}
 */
UICatalogService.prototype.getActions = function(name) {
    var deferred = Promise.defer(),
        conditions, fields, options;
    conditions = {
        name: name
    };
    fields = {
        Actions: 1
    };
    options = {};
    this.model.find(conditions, fields, options,
        function(err, catalogs) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(catalogs);
            }
        });

    return deferred.promise;
};


/*============================SMART TEMPLATES============================*/


UICatalogService.prototype.processSmartTemplates = function(files, libType, libVersion, isPrivate) {
    var result = Promise.resolve({});
    var self = this;

    var smartTemplateLibFiles = _.filter(files, function(subFile) {
        return subFile.name && !subFile.dir && subFile.name.indexOf('sap/suite/ui/generic/template') > -1;
    });

    if (smartTemplateLibFiles.length > 0) {
        var rootCatalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'helpers/SmartTemplateCatalogRoot.json')), 'utf-8');
        var customCatalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'helpers/SmartTemplateCatalogCustom.json')), 'utf-8');

        rootCatalog.catalogName = 'st' + libVersion;
        rootCatalog.description = 'Smart Template Root ' + libVersion;
        rootCatalog.displayName = 'Smart Template';
        rootCatalog.catalogLang = libType;
        rootCatalog.libraryVersion = libVersion;
        rootCatalog.isRootCatalog = true;
        rootCatalog.libraryURL = '/api/uicatalogs/' + (isPrivate ? 'private' : 'public') + '/uilib/' + libType + '/' + libVersion;
        rootCatalog.libraryPublicURL = rootCatalog.libraryURL; // same for the moment

        customCatalog.catalogName = 'stc' + libVersion;
        customCatalog.description = 'Smart Template Custom ' + libVersion;
        customCatalog.catalogLang = libType; // used by the floorplan search query
        customCatalog.isRootCatalog = false;
        customCatalog.isDefault = false;
        customCatalog.libraryURL = rootCatalog.libraryURL; // same for the moment
        customCatalog.libraryPublicURL = rootCatalog.libraryURL; // same for the moment

        result = self.createCatalog(rootCatalog)
            .then(function(stRootCatalog) {
                customCatalog.rootCatalogId = stRootCatalog._id;
                return self.createCatalog(customCatalog);
            });
    }

    return result;
};


/*============================FLOORPLANS============================*/


/**
 * getFloorPlanByLibType handler for fetching floorplans by library type
 * @libraryType  {String}
 * @return {Object}
 */
UICatalogService.prototype.getFloorPlanByLibType = function(libraryType) {
    var deferred = Promise.defer(),
        conditions, fields;

    if (libraryType === 'ui5') {
        // look for all types of ui5
        conditions = {
            $and: [{
                '$or': [{
                    'catalogLang': 'openui5'
                }, {
                    'catalogLang': 'sapui5'
                }]
            }, {
                'isRootCatalog': false
            }]
        };
    } else {
        // look for specific library type
        conditions = {
            catalogLang: libraryType,
            isRootCatalog: false
        };
    }
    fields = {
        _id: 1,
        floorPlans: 1,
        catalogName: 1,
        isDefault: 1
    };
    this.model.find(conditions, fields, {},
        function(err, catalogs) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(catalogs);
            }
        });

    return deferred.promise;
};


/*============================UI LIBRARY============================*/


UICatalogService.prototype.uploadUILibrary = function(file, libType, libVersion, isPrivate) {
    var deferredUILibraryUpload = Promise.defer();
    var self = this;

    var openui5zip = new JSZip(file[0].buffer);
    if (_.isEmpty(openui5zip.files)) {
        return deferredUILibraryUpload.reject('no files to load');
    }

    this.processSmartTemplates(openui5zip.files, libType, libVersion, isPrivate)
        .then(function () {
            var zipFilePromises = _.map(openui5zip.files, function (zipEntry) {
                var deferred = Promise.defer();
                self.storeNewFile(zipEntry, libType, libVersion, isPrivate).then(
                    function (result) {
                        deferred.resolve(result);
                    },
                    function (err) {
                        deferred.reject(err);
                    }
                );
                return deferred.promise;
            });

            Promise.all(zipFilePromises)
                .then(function (files) {
                    if (files && files.length === Object.keys(openui5zip.files).length) {
                        self.generateAndStoreMergedUI5Files(libType, libVersion).then(function () {
                            deferredUILibraryUpload.resolve();
                        }).catch(function (error) {
                            deferredUILibraryUpload.reject('Unable to generate merged UI5 files: ' + error);
                        });
                    }
                    else {
                        deferredUILibraryUpload.reject('not all files could be loaded');
                    }
                })
                .catch(deferredUILibraryUpload.reject);
        })
        .catch(deferredUILibraryUpload.reject);

    return deferredUILibraryUpload.promise;
};


UICatalogService.prototype.getCompatibleCatalogs = function(catalogId) {
    var that = this;
    var deferred = Promise.defer(),
        conditions, fields, options;
    conditions = {
        _id: new ObjectId(catalogId)
    };
    fields = {
        _id: 1,
        rootCatalogId: 1,
        catalogId: 1
    };
    options = {};
    that.model.find(conditions, fields, options,
        function(err, catalogs) {
            if (err) {
                deferred.reject(err);
            } else {
                if (undefined !== catalogs[0]) {
                    if (catalogs[0].rootCatalogId === null) {
                        that.populateRoots(catalogs[0]._id).then(
                            function(customcatalogs) {
                                deferred.resolve(that.addCatalogId(customcatalogs));
                            },
                            function(err) {
                                deferred.reject(err);
                            }
                        );
                    } else {
                        that.populateRoots(catalogs[0].rootCatalogId).then(
                            function(customcatalogs) {
                                deferred.resolve(that.addCatalogId(customcatalogs));
                            },
                            function(err) {
                                deferred.reject(err);
                            }
                        );
                    }
                } else {
                    deferred.reject(err);
                }
            }
        });

    return deferred.promise;
};


UICatalogService.prototype.updateRootCatalogId = function(rId, cId) {
    var deferred = Promise.defer();
    var condition = {
        _id: cId
    };
    var update = {
        'rootCatalogId': rId
    };
    this.model.findOneAndUpdate(condition, update, function(err, catalog) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(catalog);
        }
    });
    return deferred.promise;
};
/**
 * checkForData handler for creating predefined template data
 * total  {length}
 * cb {function}
 */
UICatalogService.prototype.updateMashupIds = function(ui5Id, angularId, htmlId) {
    var deferred = Promise.defer();
    var condition = {
        _id: ui5Id
    };
    var mashupControls = {};
    if (angularId) {
        mashupControls[angularId] = 'sap.norman.controls.Angular';
    }
    if (htmlId) {
        mashupControls[htmlId] = 'sap.ui.core.HTML';
    }
    this.model.findOne(condition, function(err, catalog) {
        if (err) {
            deferred.reject(err);
        } else {
            if (catalog) {
                catalog.mashupControls = mashupControls;
                catalog.save();
            }
            deferred.resolve(catalog);
        }
    });
    return deferred.promise;
};

UICatalogService.prototype.getCatalogById = function(catalogId) {
    var deferred = Promise.defer();
    var condition = {
        _id: new ObjectId(catalogId)
    };
    var self = this;
    this.model.findOne(condition).lean().exec(function(err, catalog) {
        if (err) {
            serviceLogger.error(new NormanError(err));
            return deferred.reject(err);
        } else {
            deferred.resolve(self.addCatalogId(catalog));
        }
    });
    return deferred.promise;
};

UICatalogService.prototype.getCatalogsByName = function(catalogNames) {
    var condition = {};
    if (catalogNames.length !== 0) {
        condition = {
            catalogName: {
                $in: catalogNames
            }
        };
    } else {
        condition = {
            isDefault: true
        };
    }
    return getCatalogsByCondition(this.model, condition);
};

UICatalogService.prototype.getCatalogsByIds = function(catalogIds) {
    var condition = {};
    if (catalogIds.length !== 0) {
        condition = {
            _id: {
                $in: catalogIds
            }
        };
    } else {
        condition = {
            isDefault: true
        };
    }
    return getCatalogsByCondition(this.model, condition);
};

function getCatalogsByCondition(model, condition) {
    var deferred = Promise.defer();
    if (_.isEmpty(condition) || _.isEmpty(model)) {
        deferred.reject('must pass valid model and condition');
    } else {
        model.find(condition).lean().exec(function(err, catalogs) {
            if (err) {
                serviceLogger.error(new NormanError(err));
                return deferred.reject(err);
            } else {
                deferred.resolve(catalogs);
            }
        });
    }
    return deferred.promise;
}


UICatalogService.prototype.populateRoots = function(id) {
    var that = this;
    var rootIds = [];
    var deferred = Promise.defer(),
        conditions, fields, options;
    conditions = {
        _id: new ObjectId(id)
    };
    fields = {
        _id: 1,
        rootCatalogId: 1,
        catalogId: 1,
        mashupControls: 1
    };
    options = {};
    that.model.find(conditions, fields, options,
        function(err, catalogs) {
            if (err) {
                deferred.reject(err);
            } else {
                if (catalogs[0].rootCatalogId === null) {
                    if (_.keys(catalogs[0].mashupControls)) {
                        rootIds = _.keys(catalogs[0].mashupControls);
                        rootIds.push(catalogs[0]._id.toHexString());
                        conditions = {};
                        var idArray = {};
                        var rootIdArray = {};
                        conditions = _.transform(rootIds, function(result, n) {
                            idArray._id = new ObjectId(n);
                            rootIdArray.rootCatalogId = new ObjectId(n);
                            result.push(idArray);
                            result.push(rootIdArray);
                            idArray = {};
                            rootIdArray = {};
                        });

                        fields = {};
                        conditions = {
                            '$or': conditions
                        };

                        that.model.find(conditions, fields).lean().exec(
                            function(err, catalogs) {
                                if (err) {
                                    serviceLogger.error(new NormanError(err));
                                    return deferred.reject(err);
                                } else {
                                    deferred.resolve(catalogs);
                                }
                            });
                    }
                }
            }
        });
    return deferred.promise;
};

UICatalogService.prototype.deleteControls = function(catalogName, catalogVersion, controls) {
    var deferred = Promise.defer(),
        self = this,
        conditions, fields, options;
    conditions = {
        catalogName: catalogName,
        catalogVersion: catalogVersion
    };
    options = {};
    this.model.findOne(conditions, fields, options,
        function(err, catalogs) {
            if (err) {
                deferred.reject(err);
            } else {
                for (var itr = 0; itr < controls.length; itr++) {
                    delete catalogs.controls[controls[itr]];
                }
                self.updateCustomCatalog(catalogs.toJSON()).then(
                    function(catalog) {
                        deferred.resolve(catalog);
                    },
                    function(err) {
                        deferred.reject(err);
                    }
                );
            }
        });

    return deferred.promise;
};


UICatalogService.prototype.getAvailableVersions = function(libraryType) {
    var deferred = Promise.defer(),
        groupConditions, matchConditions;
    matchConditions = {
        '$match': {
            '$and': [{
                'metadata.libraryType': {
                    '$eq': libraryType
                }
            }, {
                'metadata.forCanvas': {
                    '$ne': true
                }
            }]
        }
    };
    groupConditions = {
        '$group': {
            _id: '$metadata.libraryVersion'
        }
    };
    getGridModel().aggregate(
        matchConditions,
        groupConditions
    ).exec(function(err, res) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(res);
        }
    });
    return deferred.promise;
};

UICatalogService.prototype.getLibraryFile = function(type, version, pathFileName, isPrivate) {
    var deferred = Promise.defer(),
        conditions = {
            $and: [{
                'metadata.libraryType': type
            }, {
                'metadata.path': new RegExp(pathFileName + '$', 'i')
            }, {
                'metadata.libraryVersion': version
            }, {
                'metadata.isPrivate': isPrivate
            }]
        };
    getGridModel().findOne(conditions).lean().exec(function(err, file) {
        if (err) {
            deferred.reject(err);
        } else {
            if (file === null) {
                //serviceLogger.error(new NormanError(err));
                deferred.reject('file not found: ' + pathFileName);
                return deferred.promise;
            } else {
                var readStream = commonService.getGridFs().createReadStream({
                    _id: file._id,
                    root: 'library'
                }).on('error', function(err) {
                    deferred.reject(err);
                });
                deferred.resolve({
                    filename: file.filename,
                    contentType: file.metadata.contentType,
                    readStream: readStream
                });
            }
        }
    }, function(err) {
        deferred.reject(err);
    });
    return deferred.promise;
};


UICatalogService.prototype.getStringFromStream = function (fileStream){
    var deferredString = Promise.defer();
    var fileString = '';
    fileStream.on('data', function (data) {
        fileString += data;
    });

    fileStream.on('end', function () {
        deferredString.resolve(fileString);
    });
    return deferredString.promise;
};

UICatalogService.prototype.getLibraryFileString = function (fileName, libType, libVersion){
    var self = this;
    return this.getLibraryFile(libType, libVersion, fileName, false)
    .then(function(file){
        return self.getStringFromStream(file.readStream);
    });
};

UICatalogService.prototype.getMetadataGeneratorFiles = function(type, version, pathFileName) {
    var deferred = Promise.defer(),
        conditions = {
            $and: [{
                'metadata.libraryType': type
            }, {
                'metadata.path': new RegExp(pathFileName + '$', 'i')
            }, {
                'metadata.libraryVersion': version
            }, {
                'metadata.forCanvas': true
            }]
        };
    getGridModel().findOne(conditions).lean().exec(function(err, file) {
        if (err) {
            deferred.reject(err);
        } else {
            if (file === null) {
                serviceLogger.error(new NormanError(err));
                deferred.reject('file not found: ' + pathFileName);
                return deferred.promise;
            } else {
                var readStream = commonService.getGridFs().createReadStream({
                    _id: file._id,
                    root: 'library'
                }).on('error', function(err) {
                    deferred.reject(err);
                });
                deferred.resolve({
                    filename: file.filename,
                    contentType: file.metadata.contentType,
                    readStream: readStream
                });
            }
        }
    }, function(err) {
        deferred.reject(err);
    });
    return deferred.promise;
};


UICatalogService.prototype.checkForData = function(rootCatalog, customCatalogs) {
    var that = this;
    var rootCatalogId = rootCatalog._id;
    //will return the custom catalog
    var updateCustomCatalogs = _.map(customCatalogs, function(customCatalog) {
        var customCatalogId = customCatalog._id;
        return that.updateRootCatalogId(rootCatalogId, customCatalogId);
    });
    return Promise.all(updateCustomCatalogs);
};

UICatalogService.prototype.getFiles = function(fileNames) {
    if (_.isEmpty(fileNames)) {
        return promise.reject('no files to load');
    }
    var filePath = '../../api/catalog/sampleTemplate/';
    var filePromises = _.map(fileNames, function(fileName) {
        var fullPath = path.join(__dirname, filePath + fileName);
        var deferred = Promise.defer();
        fs.readFile(fullPath, 'utf8', function(err, data) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(data);
            }
        });
        return deferred.promise;
    });
    return Promise.all(filePromises)
        .then(function(files) {
            if (files && files.length === fileNames.length) {
                return Promise.resolve(files);
            } else {
                return Promise.reject('not all files could be loaded');
            }
        });
};

/**
 * initializeDb preload uicatalog db with predefined data
 * callback  {function}
 */
UICatalogService.prototype.initializeDb = function(callback) {
    logger.info('initializing UICatalogService db');

    // array of predefined catalogs to be loaded
    var catalogToReturnName = 'r4ui5.json';
    //put here root: [custom, custom]
    var catalogsFileNames = {
        'r4ui5.json': ['r4c1ui5.json']
    };

    var that = this;
    var catalogToReturn;

    //TODO move this in a separate place
    var ui5Id, angularId, htmlId;
    //read row by row the object
    var promises = _.map(catalogsFileNames, function(customCatalogsFileNames, rootCatalogFileName) {
        // flatten the file names
        var fileNames = _.clone(customCatalogsFileNames);
        //last one is the root!
        fileNames.push(rootCatalogFileName);
        var indexOfCatalogToReturn = _.indexOf(fileNames, function(name) {
            return name === catalogToReturnName;
        });
        //read files
        return that.getFiles(fileNames)
            //map files to json objects
            .then(function(files) {
                return _.map(files, JSON.parse);
            })
            //update all catalogs
            .then(function(jsons) {
                var updatePromises = _.map(jsons, function(json) {
                    return that.updateCatalog(json);
                });
                return Promise.all(updatePromises);
            })
            //associate rootControlID to custom catalogs
            .then(function(catalogs) {
                if (indexOfCatalogToReturn >= 0) {
                    catalogToReturn = catalogs[indexOfCatalogToReturn];
                }
                //because last one is the roots
                var rootCatalog = catalogs.pop();
                var customCatalogs = catalogs;

                //TODO move this in a separate place
                var rootCatalogId = rootCatalog._id;
                if (rootCatalogFileName === 'r4ui5.json') {
                    ui5Id = rootCatalogId;
                } else if (rootCatalogFileName === 'r2angular.json') {
                    angularId = rootCatalogId;
                } else if (rootCatalogFileName === 'r3html.json') {
                    htmlId = rootCatalogId;
                }
                return that.checkForData(rootCatalog, customCatalogs);
            });
    });
    Promise.all(promises)
        // assumes all ids have been set
        //TODO move this in a separate place
        .then(function() {
            return that.updateMashupIds(ui5Id, angularId, htmlId);
        })
        //return only the main catalog
        .then(function() {
            callback(null, catalogToReturn);
        })
        .catch(function(err) {
            callback(err, err);
        });
};

UICatalogService.prototype.mergeUI5LibraryPreloadFiles = function(libType, libVersion, libraries, thirdPartFileNames, fileName) {
    var self = this;

    var createPreloadString = function(preloadObject){
        return 'jQuery.sap.registerPreloadedModules(' + preloadObject + ');' + os.EOL;
    };
    var createCustomLibraryString = function (libraryName, filesWithContent) {
        var preloadObject = {
            'version': '2.0',
            'name': libraryName,
            'modules': filesWithContent
        };
        return createPreloadString(JSON.stringify(preloadObject));
    };
    var thirdpartyFilePromises = _.map(thirdPartFileNames, function (thirdPartyFileName){
        var fileName = 'resources/' + thirdPartyFileName;
        return self.getLibraryFileString(fileName, libType, libVersion);
    });
    var mergedThirdpartFilePromise = Promise.all(thirdpartyFilePromises).then(function(thirdPartFiles){
        var filesWithContent = _.zipObject(thirdPartFileNames, thirdPartFiles);
        return createCustomLibraryString('sap.ui.custom.library-preload', filesWithContent);
    });

    var getLibrary = function (library){
        var fileName = 'resources/' + library + '/library-preload.json';
        return self.getLibraryFileString(fileName, libType, libVersion).then(createPreloadString);
    };
    var libraryContentPromises = _.map(libraries, getLibrary);
    libraryContentPromises.push(mergedThirdpartFilePromise);
    var mergedLibrariesPromise = Promise.all(libraryContentPromises).then(function(libraryStringArray){
        return libraryStringArray.join(os.EOL);
    });
    var createSapUiCorePreloaded = function(sapUICoreContent, mergedLibraries) {
        var insertPosition = sapUICoreContent.indexOf('jQuery.sap.declare(\'sap-ui-core\')');
        var sapUICoreContentWithLibraries = sapUICoreContent.slice(0, insertPosition);
        sapUICoreContentWithLibraries += os.EOL + mergedLibraries + os.EOL;
        sapUICoreContentWithLibraries += sapUICoreContent.slice(insertPosition);
        return sapUICoreContentWithLibraries;
    };
    var sapUICorePromise = self.getLibraryFileString('resources/sap-ui-core.js', libType, libVersion);

    return Promise.all([sapUICorePromise, mergedLibrariesPromise]).then(function(fileContentArray){
        var sapUICoreContent = fileContentArray[0];
        var mergedLibraries = fileContentArray[1];
        return createSapUiCorePreloaded(sapUICoreContent, mergedLibraries);
    }).then(function(fileContent) {
        return self.storeNewFileFromString(fileName, fileContent, libType, libVersion, false);
    }).catch(function(error){
        return Promise.reject('Unable to generate sap-ui-core with preloaded library files : ' + error);
    });
};

UICatalogService.prototype.mergeUI5LibraryCSSFiles = function(libType, libVersion, libraries, themeName, fileName) {
    var self = this;
    var mergeCssFile = function(libraryName){
        var fileName = 'resources/' + libraryName + '/themes/' + themeName + '/library.css';
        return self.getLibraryFileString(fileName, libType, libVersion);
    };
    var cssFileContentPromises = _.map(libraries, mergeCssFile);
    return Promise.all(cssFileContentPromises).then(function(libraryStringArray){
        return libraryStringArray.join(os.EOL);
    }).then(function(mergedCssFileContent) {
        return self.storeNewFileFromString(fileName, mergedCssFileContent, libType, libVersion, false);
    });
};

UICatalogService.prototype.generateAndStoreMergedUI5Files = function(libType, libVersion) {
    var tasks = [];

    tasks.push(this.mergeUI5LibraryCSSFiles(libType, libVersion, OPEN_CSS_LIBRARIES, 'sap_bluecrystal', OPEM_CSS_FILE_NAME));
    tasks.push(this.mergeUI5LibraryPreloadFiles(libType, libVersion, OPEN_JS_LIBRARIES, OPEM_THIRD_PART_FILE_NAMES, OPEM_JS_FILE_NAME));

    if (libType !== 'openui5') {
        tasks.push(this.mergeUI5LibraryCSSFiles(libType, libVersion, SMART_CSS_LIBRARIES, 'sap_bluecrystal', SMART_CSS_FILE_NAME));
        tasks.push(this.mergeUI5LibraryPreloadFiles(libType, libVersion, SMART_JS_LIBRARIES, SMART_THIRD_PART_FILE_NAMES, SMART_JS_FILE_NAME));
    }

    return Promise.all(tasks);
};

UICatalogService.prototype.initializeLibrary = function () {
    logger.info('initializing UICatalogService library');
    // we can populate the data from config.json
    var self = this;
    var libraryType = 'openui5';
    var libraryVersion = '1.26.6';

    var openui5zip;
    var conditions = {
        $and: [
            {'metadata.libraryType': libraryType},
            {'metadata.libraryVersion': libraryVersion},
            {'metadata.isPrivate': false}
        ]
    };

    return new Promise(function (resolve, reject) {
        getGridModel().remove(conditions).lean().exec(function (gridModelError/*, file*/) {
            if (gridModelError) {
                reject(gridModelError);
            }
            return Promise.invoke(fs.readFile, self.readAndGenerateZip())
                .then(function (data) {
                    openui5zip = new JSZip(data);
                    if (_.isEmpty(openui5zip.files)) {
                        return Promise.reject('no files to load');
                    }
                    var filePromisesArray = _.map(openui5zip.files, function (fileObject) {
                        return self.storeNewFile(fileObject, libraryType, libraryVersion, false);
                    });
                    return Promise.all(filePromisesArray);
                })
                .then(function (/*files*/) {
                    return self.generateAndStoreMergedUI5Files(libraryType, libraryVersion);
                })
                .then(function() {
                    logger.info('Successful initialize for UICatalogManager');
                    resolve();
                })
                .catch(function (err) {
                    logger.error(err, 'Initialize failed for UICatalogManager');
                    reject(err);
                });
        });
    });
};

UICatalogService.prototype.readAndGenerateZip = function() {
    var fileName = 'openui5-runtime-1.26.6.zip';
    var filePath = '../../api/catalog/sampleTemplate/';
    var zipfile = path.join(__dirname, filePath + fileName);
    return zipfile;
};

UICatalogService.prototype.extractLibrary = function(callback) {
    logger.info('initializing metadata generator');
    var filePath = '../../api/catalog/metadata/';
    var fullPath = path.join(__dirname, filePath);
    var files = fs.readdirSync(fullPath);

    var conditions = {
        'metaData.forCanvas': true
    };

    getGridModel().remove(conditions).lean().exec(function(err, file) {
        if (err) {
            callback(err, err);
        }
    });
    var filePromises = _.map(files, function(file) {
        var deferred = Promise.defer();
        var metaData = {};
        metaData.contentType = mime.lookup(path.basename(file));
        metaData.forCanvas = true;
        metaData.updated_at = Date.now();
        metaData.created_at = Date.now();
        metaData.libraryType = 'openui5';
        metaData.libraryVersion = '1.0';
        metaData.isPrivate = false;
        metaData.path = fullPath + file;
        var writeStream = commonService.getGridFs().createWriteStream({
            filename: file,
            mode: 'w',
            metadata: metaData,
            root: 'library'
        });

        var output;
        try {
            output = fs.readFileSync(fullPath + file);
        } catch (err) {
            logger.error('error' + err);
        }
        var readStream = stream.createReadStream(output).pipe(writeStream);
        readStream.on('close', function(zipEntryToken) {
            deferred.resolve(zipEntryToken);
        });
        readStream.on('error', function(err) {
            deferred.reject(err);
        });
        metaData = {};
        return deferred.promise;
    });
    Promise.all(filePromises)
        .then(function(fileNames) {
            if (fileNames && fileNames.length === files.length) {
                callback(null, fileNames);
            } else {
                callback(null, 'not all files could be loaded');
            }
        });
};

function endsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

UICatalogService.prototype.getMetaDataForSave = function(fileName, isDirectory, libType, libVersion, isPrivate) {
    var metaData = {},filePath;
    metaData.updated_at = Date.now();
    metaData.created_at = Date.now();
    metaData.libraryType = libType;
    metaData.libraryVersion = libVersion;
    metaData.isPrivate = isPrivate;
    if (!isDirectory && !endsWith(fileName, '/')) {
        var regex = new RegExp('[^/]+$');
        filePath = fileName;
        var match = regex.exec(fileName);
        fileName = match[0];
        metaData.extension = match[0].split('.')[1];
        try {
            metaData.contentType = mime.lookup(metaData.extension);
        } catch (err) {
            logger.info('couldn\'t get content type for ' + metaData.name);
        }
    }
    metaData.path = filePath;
    return metaData;
};

UICatalogService.prototype.storeNewFileFromStream = function(fileName, isDirectory, fileStream, libType, libVersion, isPrivate) {
    var deferred = Promise.defer();
    var metaData = this.getMetaDataForSave(fileName, isDirectory, libType, libVersion, isPrivate);
    var writeStream = commonService.getGridFs().createWriteStream({
        filename: fileName,
        mode: 'w',
        metadata: metaData,
        root: 'library'
    });

    var readStream = fileStream.pipe(writeStream);
    readStream.on('close', function(zipEntryToken) {
        writeStream.end();
        deferred.resolve(fileName);
    });
    readStream.on('error', function(err) {
        logger.error('Unable to store file ' + fileName + '. Error in the readstream: ' + err);
        deferred.reject(err);
    });
    return deferred.promise;
};

UICatalogService.prototype.importCatalog = function(file) {
    var defPromise = Promise.defer();
    var self = this;
    var buffer;
    var jsonContent = {};
    var mimetype = file[0].mimetype;
    switch (mimetype) {
        case 'application/json':
            buffer = new Buffer(file[0].buffer);
            jsonContent = JSON.parse(buffer.toString('utf8'));
            self.createCatalog(jsonContent).then(
                function(result) {
                    defPromise.resolve(result);
                }, function(err) {
                    defPromise.reject(err);
                }
            );
            break;
        case 'application/zip':
            self.readContentOfImportZip(file).then(
                function(result) {
                    defPromise.resolve(result);
                }, function(err) {
                    defPromise.reject(err);
                }
            );
            break;
        default:
            defPromise.reject('only json file and zip file are allowed');
    }
    return defPromise.promise;
};

UICatalogService.prototype.readContentOfImportZip = function(zipFile) {
    var self = this;
    var deferred = Promise.defer();
    var zip = new JSZip(zipFile[0].buffer);
    if (_.isEmpty(zip.files)) {
        return deferred.reject('no files to load');
    }
    var zipFilePromises = _.map(zip.files, function(zipEntry) {
        var defPromise = Promise.defer();
        var fileName = zipEntry.name;
        var match, content, objectid;
        // catch the file name
        var regex = new RegExp('[^/]+$');
        try {
            if (!zipEntry.dir && !endsWith(zipEntry.name, '/')) {
                match = regex.exec(zipEntry.name);
                // file name extracted
                fileName = match[0];
                // file content extracted as text
                content = JSON.parse(zipEntry.asText());
                //create the catalog from the json content of the file
                self.createCatalog(content).then(
                    function(result) {
                        defPromise.resolve(fileName);
                    }, function(err) {
                        defPromise.reject(err);
                    }
                );
            }
        } catch (err) {
            return defPromise.reject(err);
        }
        return defPromise.promise;
    });

    return Promise.all(zipFilePromises)
        .then(function(files) {
            if (files && files.length === Object.keys(zip.files).length) {
                return Promise.resolve(files);
            } else {
                return Promise.reject('not all files could be loaded');
            }
        });
};
UICatalogService.prototype.upgradeSchema = function (version, done) {
    logger.debug('upgradeSchema for UICatalogManager');
    var self = this;
    logger.debug('upgradeSchema version is: ', version);

    switch (version.minor) {
        case 0:
            var upgradeUICatalog = this.upgrade_0_1_0();
            var upgradeSTCatalog = this.upgradeSmartCatalog();

            Promise.all([upgradeUICatalog, upgradeSTCatalog])
                .then(function () {
                    return self.upgradeGenerateBundledLibraries();
                })
                .callback(done);
            break;
        default:
            done();
            break;
    }
};

UICatalogService.prototype.upgrade_0_1_0 = function () {
  logger.debug('Running upgrade_0_1_0 for UICatalogManager');
  var fileNames = ['r4ui5.json', 'r4c1ui5.json'],
  filePath = '../../api/catalog/sampleTemplate/',
  self = this,
  deferred = Promise.defer(),
  fileInfo = [],
  filesUnused = ['openui5r1-1_0', 'r1c1ui5-1_0', 'r1c2ui5-1_0', 'r2angular-0.1', 'r2c1angular-0.1', 'r3html-0.1', 'r3c1html-0.1'];
  // 1) As part of migration, overwrite the r4 catalogs with the latest data.
  var fileUpdate = _.map(fileNames, function(fileName) {
    var fullPath = path.join(__dirname, filePath + fileName);
    fs.readFile(fullPath, 'utf8', function(error, data) {
      if (error) {
        deferred.reject(error);
      } else {
        data = JSON.parse(data);
        delete data.rootCatalogId;
        self.updateCatalog(data).then(
          function(catalogs){
            deferred.resolve(catalogs);
          }, function(err){
            deferred.reject(err);
          });
      }
    });
  });
  // 2) As part of migration, remove the catalogs that are not loaded as part of beta3
  var fileRemoval = _.map(filesUnused, function (fileData){
    fileInfo = fileData.split('-');
    // feed in the catalogName and catalogVersion of the files to be removed
    self.deleteCatalog(fileInfo[0], fileInfo[1]).then(
      function(catalogs){
        deferred.resolve(catalogs);
      }, function(err){
        deferred.reject(err);
      });
  });
  Promise.all([fileUpdate, fileRemoval])
  .then(function(files){
    if (files) {
      return deferred.resolve(files);
    }
  }).catch(function (err) {
    deferred.reject('could not resolve all promises', err);
  });
  return deferred.promise;
};

UICatalogService.prototype.storeNewFileFromString = function(fileName, fileContent, libType, libVersion, isPrivate) {
    var fileStream = stream.createReadStream(fileContent);
    return this.storeNewFileFromStream(fileName, false, fileStream, libType, libVersion, isPrivate);
};

UICatalogService.prototype.storeNewFile = function(zipEntry, libType, libVersion, isPrivate) {
    var fileName = zipEntry.name;
    var fileStream =  stream.createReadStream(zipEntry.asNodeBuffer());
    return this.storeNewFileFromStream(fileName, zipEntry.dir, fileStream, libType, libVersion, isPrivate);
};

function updateSmartCatalog(self, fileName) {
    return Promise.invoke(fs.readFile, path.resolve(__dirname, fileName), 'utf8')
        .then(function (data) {
            var catalog = JSON.parse(data, 'utf-8');
            return new Promise(function (resolve, reject) {
                var condition = {$and: [{catalogName: catalog.catalogName}, {catalogVersion: catalog.catalogVersion}]};

                self.model.findOne(condition, function (error, ctlog) {
                    if (error) {
                        reject(error);
                    }
                    else {
                        if (ctlog) {
                            self.updateCatalog(catalog)
                                .then(function (updatedCatalog) {
                                    return self.generateAndStoreMergedUI5Files(updatedCatalog.catalogLang, updatedCatalog.libraryVersion);
                                })
                                .then(resolve)
                                .catch(reject);
                        }
                        else {
                            resolve();
                        }
                    }
                });
            });
        });
}

UICatalogService.prototype.upgradeSmartCatalog = function () {
    logger.debug('Running upgradeSmartCatalog for UICatalogManager');
    var self = this;

    return updateSmartCatalog(self, 'helpers/SmartTemplateCatalogRoot.json')
        .then(function(){
            return updateSmartCatalog(self, 'helpers/SmartTemplateCatalogCustom.json');
        });
};

/**
 * Loops over all available libraries and generates the bundle files for each and every available library.
 *
 * @returns {Promise}
 */
UICatalogService.prototype.upgradeGenerateBundledLibraries = function () {
    logger.debug('Running generating bundled library files');
    var self = this;

    return this.getAllLibrariesAndVersions()
        .then(function (librariesAndVersions) {
            var promises = [];
            _.map(librariesAndVersions, function(libraryAndVersion){
                promises.push(self.generateAndStoreMergedUI5Files(libraryAndVersion.type, libraryAndVersion.version));
                logger.debug('Created bundle for library: ' + JSON.stringify(libraryAndVersion));
            });
            return Promise.all(promises);
        });
};
