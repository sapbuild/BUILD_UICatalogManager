'use strict';

var _ = require('norman-server-tp').lodash;
//var viewParser = require('./viewParser');
var path = require('path');
var fs = require('fs');

var libFiles = [], rootPath = '';

//------------------------------------------------ Pattern and Design Template functions ---------------------------------------------------
var cleanData = function (data, cleanedData, varPool) {
    _.each(data, function (controlData) {
        if (controlData.children != null || controlData.properties) {
            var control = _.clone(controlData, true);
            control.children = [];
            var newVarPool = _.clone(varPool);
            if (control.template) {
                _.each(control.template, function (templateInfo) {
                    if (templateInfo.type === 'repeat') {
                        var varName = _.find(templateInfo.props, function (property, propertyName) {
                            return propertyName === 'var';
                        });
                        var listInfo = _.find(templateInfo.props, function (property, propertyName) {
                            return propertyName === 'list';
                        });
                        if (varName) {
                            newVarPool[varName] = listInfo;
                        }
                    }
                });
            }
            cleanData(controlData.children, control.children, newVarPool);
            if (control.children.length === 0) {
                delete control.children;
            }

            var newProps = null;
            _.each(control.properties, function (propertyValue, propertyName) {
                newProps = newProps || {};
                if (propertyValue.model === 'meta') {
                    propertyValue.model = '';
                }
                else {
                    var varData = newVarPool[propertyValue.model];
                    if (varData) {
                        var filters = '/';
                        if (varData.filters) {
                            console.log(varData.filters);
                            var operation = (varData.filters.operator === 'EQ') ? '=' : varData.filters.operator;
                            filters = '[@' + varData.filters.path + operation + varData.filters.value1 + ']';
                            filters += '/';
                        }
                        propertyValue = varData.path + filters + '_' + propertyValue.model + 'Index_/' + propertyValue.path;
                    }
                }
                newProps[propertyName] = propertyValue;
            });
            if (newProps != null) {
                control.properties = newProps;
            }

            cleanedData.push(control);
        }
    });
};

var patternify = function (cleanedData, patternedData, parentPatterns) {
    _.each(cleanedData, function (cleanControl) {
        var instantiatedPattern;
        if (cleanControl.metadata) {

            var bIsInheritance = false;
            instantiatedPattern = _.find(parentPatterns, function (pattern) {
                return pattern.type === cleanControl.metadata.type;
            });
            var instantiatedPatternParent = null;
            if (!instantiatedPattern) {
                instantiatedPatternParent = _.find(parentPatterns, function (pattern) {
                    return pattern.type === cleanControl.metadata.inherit;
                });
                bIsInheritance = instantiatedPatternParent != null;
            }

            var bIsNew = false;
            if (!instantiatedPattern) {
                bIsNew = true;
                instantiatedPattern = {
                    type: cleanControl.metadata.type,
                    template: cleanControl.template,
                    properties: {}
                };

                parentPatterns.push(instantiatedPattern);
            }
            if (cleanControl.metadata.condition) {
                if (!instantiatedPattern.template) {
                    instantiatedPattern.template = {};
                }
                if (!instantiatedPattern.template.conditions) {
                    instantiatedPattern.template.conditions = [];
                }
                instantiatedPattern.template.conditions.push(
                    {
                        type: 'if',
                        target: cleanControl.metadata.condition.target,
                        value: cleanControl.metadata.condition.value
                    }
                );
            }
            if (cleanControl.metadata.bindingContext) {
                //keep this for parsing the controls from the design template
                instantiatedPattern.bindingContext = cleanControl.metadata.bindingContext;
                //add the property corresponding to the binding context in the design template
                instantiatedPattern.properties[cleanControl.metadata.bindingContext.name] = cleanControl.metadata.bindingContext.value;
                instantiatedPattern.properties[cleanControl.metadata.bindingContext.name].attribute = 'EntityPath';

            }
            if (cleanControl.metadata.isAbstract) {
                instantiatedPattern.isAbstract = true;
            }
            _.each(cleanControl.properties, function (propertyValue, propertyName) {
                if (cleanControl.metadata && cleanControl.metadata.properties && cleanControl.metadata.properties[propertyName]) {
                    //we deal here with our custom binding with '@@' if need be
                    if (propertyValue.path && propertyValue.path.indexOf('@@') > -1) {
                        var resolvedPathVar = propertyName + 'GeneratedVar';
                        //generate the variable of the resolved property
                        if (!instantiatedPattern.template) {
                            instantiatedPattern.template = {};
                        }
                        if (!instantiatedPattern.template.var) {
                            instantiatedPattern.template.var = {};
                        }
                        instantiatedPattern.template.var[resolvedPathVar] = 'sap.ui.model.odata.AnnotationHelper.resolvePath(' + propertyValue.model + '>' + propertyValue.path.split('@@')[0] + ')';
                        //modify the binding
                        propertyValue.model = resolvedPathVar;
                        propertyValue.path = propertyValue.path.split('@@')[1];
                    }
                    instantiatedPattern.properties[cleanControl.metadata.properties[propertyName]] = propertyValue;
                }
            });
            if (cleanControl.metadata.staticProps) {
                _.each(cleanControl.metadata.staticProps, function (value) {
                    instantiatedPattern.properties[value].static = true;
                });
            }
            if (bIsInheritance) {
                instantiatedPatternParent.instanceChoice = instantiatedPatternParent.instanceChoice || [];
                instantiatedPatternParent.instanceChoice.push(instantiatedPattern);
                instantiatedPattern.children = [];
            }
            else if (bIsNew) {
                if (cleanControl.metadata.forceParent) {
                    var foundParent = _.find(parentPatterns, function (pattern) {
                        return pattern.type === cleanControl.metadata.forceParent;
                    });
                    foundParent.children.push(instantiatedPattern);
                }
                else {
                    patternedData.push(instantiatedPattern);
                }
                instantiatedPattern.children = [];
            }
            patternify(cleanControl.children, instantiatedPattern.children, parentPatterns);
        }
        else {
            if (cleanControl.controlName === 'sap.ui.core.Fragment') {
                instantiatedPattern = {
                    type: 'sap.ui.core.Fragment',
                    template: cleanControl.template,
                    fragmentName: cleanControl.properties.fragmentName
                };
                patternedData.push(instantiatedPattern);
            }
            patternify(cleanControl.children, patternedData, parentPatterns);
        }
    });
};

var postProcessTemplate = function (patternifiedTree) {

    _.each(patternifiedTree, function (pattern) {
        if (pattern.template && pattern.template.conditions && pattern.template.conditions.length) {
            var conditionsArray = pattern.template.conditions, i;
            _.each(conditionsArray, function (condition) {
                if (condition.type === 'if') {
                    if (condition.test) {
                        var splitEqualOperands = condition.test.split('===');
                        if (splitEqualOperands.length > 1) {
                            //the tested property tests an equality
                            condition.target = splitEqualOperands[0].replace(/[^\w\x3e\x28\x29\x96]/gi, '');
                            condition.value = splitEqualOperands[1].replace(/[^\w\x28\x29\x2e]/gi, '');
                        }

                    }
                }
            });

            if (pattern.template.conditions.length > 1) {
                for (i = 1; i < conditionsArray.length; i++) {
                    //we use this step to simplify if then and if then else
                    if (conditionsArray[i].type === 'then') {
                        conditionsArray.splice(i, 1);
                        i = i - 1;
                    }
                    else if (conditionsArray[i].type === 'else') {
                        if (conditionsArray[i - 1].type === 'if') {
                            conditionsArray[i - 1].type = 'unless';
                        }
                        conditionsArray.splice(i, 1);
                        i = i - 1;
                    }
                }
            }

            //manage the repeatType && annotationType
            for (i = 0; i < conditionsArray.length; i++) {
                if (conditionsArray[i].type === 'if' && conditionsArray[i].target && conditionsArray[i].target.indexOf('RecordType') > -1) {
                    pattern.template.repeatType = conditionsArray[i].value;
                    conditionsArray.splice(i, 1);
                    i = i - 1;
                }
                else if (conditionsArray[i].type === 'if' && conditionsArray[i].target && conditionsArray[i].target.indexOf('AnnotationType') > -1) {
                    // an annotation condition is written with the syntax condition:{{targetVariable}}>AnnotationType:{{Annotation Type for the target variable}}
                    // for instance condition:collection>AnnotationType:UI.LineItem
                    if (!pattern.template.termInfo) {
                        pattern.template.termInfo = {};
                    }
                    var key = conditionsArray[i].target.split('>')[0];
                    pattern.template.termInfo[key] = conditionsArray[i].value;
                }
            }
            pattern.template.conditions = conditionsArray;
        }
        //transform children into groups
        if (pattern.children && pattern.children.length) {
            pattern.groups = {};
        }
        _.each(pattern.children, function (child) {
            var groupName;
            if (child.type === 'sap.ui.core.Fragment') {
                groupName = 'fragments';
            }
            else {
                groupName = child.type.charAt(0).toLowerCase() + child.type.slice(1) + 's';
            }
//            var childTypeDot = child.type.lastIndexOf(".");
//            var childType = child.type.substr(childTypeDot + 1);
//            var groupName = _.camelCase(childType) + 's';
            pattern.groups[groupName] = child;

        });
        delete pattern.children;
        postProcessTemplate(_.values(pattern.groups));
        postProcessTemplate(pattern.instanceChoice);
    });

};

// we extract the controls that we need from the designtemplates
var processControlsForFloorplan = function (control, parentName, prefix, catalog, abstractParent) {
    var result, parentForIteration, propertyList = [];
    if (control.isAbstract) {
        //we keep abstract controls in the controlMap of the catalog but not displayed to the user
        result = {
            additionalMetadata: {
                aggregations: {},
                associations: [],
                defaultAggregation: '',
                properties: {}
            },
            description: control.type,
            displayName: control.type,
            displayToUser: false,
            groupName: parentName + ' Controls',
            name: prefix + '-' + control.type
        };
        propertyList = _.keys(control.properties);
        _.each(propertyList, function (propName) {
            if (propName) {
                result.additionalMetadata.properties[propName] = {
                    displayName: propName,
                    name: propName,
                    type: 'string',
                    displayToUser: false,
                    isLinkProperty: false
                };
                result.additionalMetadata.properties[propName].isDataDriven = control.properties[propName].static ? false : true;
                if (_.endsWith(control.properties[propName].path, 'Importance/EnumMember')) {
                    result.additionalMetadata.properties[propName].possibleValues = ['High', 'Medium', 'Low'];
                }
                else if (_.endsWith(control.properties[propName].path, 'Bool') || _.endsWith(control.properties[propName].path, 'Nullable')) {
                    result.additionalMetadata.properties[propName].possibleValues = ['true', 'false'];
                }
                else if (_.endsWith(control.properties[propName].path, 'Url') && !_.endsWith(control.properties[propName].path, 'ImageUrl')) {
                    // we want to differentiate between URLs for navigation and URLs for image binding
                    result.additionalMetadata.properties[propName].isLinkProperty = true;
                }
            }
        });
        parentForIteration = parentName;
        // we iterate passing the abstract control
        if (control.instanceChoice) {
            _.each(control.instanceChoice, function (choice) {
                processControlsForFloorplan(choice, parentForIteration, prefix, catalog, control);
            });
        }
    }
    else {
        result = {
            additionalMetadata: {
                aggregations: {},
                associations: [],
                defaultAggregation: '',
                properties: {},
                icon: "/resources/norman-ui-catalog-manager-client/assets/smartTemplates/" + control.type + ".svg"
            },
            description: control.type,
            displayName: control.type,
            displayToUser: true,
            diffName: defaultDifferentiatingName(control.type),
            groupName: parentName + ' Controls',
            name: prefix + '-' + control.type
        };
        //we keep the Structural control (ObjectPage-ObjectPage or ListReport-ListReport) hidden to the user
        if (control.type === prefix) {
            result.displayToUser = false;
        }

        parentForIteration = control.type;
        //manage properties
        if (control.properties) {
            propertyList = _.keys(control.properties);
        }
        //manage inheritance
        if (abstractParent) {
            if (abstractParent.properties) {
                propertyList = propertyList.concat(_.keys(abstractParent.properties));
            }
        }
        // we add all the necessary properties to the result
        _.each(propertyList, function (propName) {
            if (propName) {
                result.additionalMetadata.properties[propName] = {
                    displayName: propName,
                    name: propName,
                    type: 'string',
                    displayToUser: true,
                    isLinkProperty: false
                };
                result.additionalMetadata.properties[propName].isDataDriven = control.properties[propName].static ? false : true;
                if (_.endsWith(control.properties[propName].path, 'Importance/EnumMember')) {
                    result.additionalMetadata.properties[propName].possibleValues = ['High', 'Medium', 'Low'];
                    result.additionalMetadata.properties[propName].defaultValue = 'High';
                }
                else if (_.endsWith(control.properties[propName].path, 'Bool') || _.endsWith(control.properties[propName].path, 'Nullable')) {
                    result.additionalMetadata.properties[propName].possibleValues = ['true', 'false'];
                }
                else if (_.endsWith(control.properties[propName].path, 'Url') && !_.endsWith(control.properties[propName].path, 'ImageUrl')) {
                    // we want to differentiate between URLs for navigation and URLs for image binding
                    result.additionalMetadata.properties[propName].isLinkProperty = true;
                }
            }

        });
        //manage aggregations & iterate
        if (control && control.groups) {

            _.forIn(control.groups, function (value, key) {

                //if the aggregation is not yet registered we add it
                var bIsmultiple = false,
                    types = [prefix + '-' + value.type];
                if (value.template && value.template.repeat) {
                    bIsmultiple = true;
                }
                if (value.isAbstract) {
                    types = [];
                    //we reset the types to get the instance choices and not the abstract type
                    _.each(value.instanceChoice, function (choice) {
                        types.push(prefix + '-' + choice.type);
                    });
                }
                if (!bIsmultiple && control.type === 'Section') {
                    //if the children are not multiple we put them under the choice aggregation
                    //This is to deal with Section
                    //TODO : refine this mechanism
                    if (!result.additionalMetadata.aggregations.sectionContent) {
                        result.additionalMetadata.aggregations.sectionContent = {
                            altTypes: ['string'],
                            isDataDriven: false,
                            displayName: 'sectionContent',
                            multiple: false,
                            name: 'sectionContent',
                            types: [],
                            displayToUser: true,
                            visibility: 'public'
                        };
                    }
                    result.additionalMetadata.aggregations.sectionContent.types.push(prefix + '-' + value.type);
                }
                else {
                    result.additionalMetadata.aggregations[key] = {
                        altTypes: ['string'],
                        isDataDriven: false,
                        displayName: key,
                        multiple: bIsmultiple,
                        name: key,
                        types: types,
                        displayToUser: true,
                        visibility: 'public'
                    };
                }
                processControlsForFloorplan(value, parentForIteration, prefix, catalog);
            });
        }
        //manage binding context
        if (control.bindingContext) {
            var bindingContext = _.clone(control.bindingContext);
            result.additionalMetadata.properties[bindingContext.name].isContextProperty = true;
            if (bindingContext.target) {
                result.additionalMetadata.aggregations[bindingContext.target].contextProperty = bindingContext.name;
            }
            delete control.bindingContext;
        }
        //save the result in the catalog
        catalog.controls[result.name] = result;
    }
};

var postProcessCatalog = function (catalog) {
    if (catalog && catalog.floorPlans) {
        _.forIn(catalog.floorPlans, function (floorplan) {
            if (floorplan.designTemplate) {
                processControlsForFloorplan(floorplan.designTemplate, 'root', floorplan.name, catalog);
                prefixControlInDesignTemplate(floorplan.designTemplate, floorplan.name);
            }
        });
    }
};

var prefixControlInDesignTemplate = function (control, preffix) {
    control.type = preffix + '-' + control.type;
    if (control.instanceChoice) {
        _.each(control.instanceChoice, function (choice) {
            prefixControlInDesignTemplate(choice, preffix);
        });
    }
    if (control.groups) {
        _.forIn(control.groups, function (value) {
            prefixControlInDesignTemplate(value, preffix);
        });
    }
};

//this is to add the default content to the catalog for each floorplan
var addControlsInCatalog = function (catalog, version) {
    if (catalog && catalog.floorPlans) {
        _.forIn(catalog.floorPlans, function (floorplan) {
            if (floorplan.designTemplate) {
                var firstControlName = floorplan.designTemplate.type;
                var groups = [];
                _.each(_.keys(floorplan.designTemplate.groups), function (key) {
                    groups.push({groupId: key, children: []});
                });
                floorplan.controls = {
                    name: floorplan.name,
                    rootControlId: 'root-' + firstControlName + '-Id',
                    controls: [
                        {
                            controlId: 'root-' + firstControlName + '-Id',
                            controlName: firstControlName,
                            parentControlId: null,
                            catalogControlName: firstControlName,
                            properties: [],
                            groups: groups
                        }
                    ]
                };
                if (version === '1.30.2') {
                    // Default content for specific Smart Template floorplans for the 1.30.1 version
                    if (floorplan.name === 'ListReport') {
                        floorplan.controls.controls = addDefaultContent('ListReport');
                    }
                    else if (floorplan.name === 'ObjectPage') {
                        floorplan.controls.controls = addDefaultContent('ObjectPage');
                    }
                }
            }
        })
    }
};

//----------------------------------------------- Default Content ---------------------------------------------

// this is to add the default content to the floorplan
var addDefaultContent = function (filename) {
    //TODO:  fix - make async
    var defaultContentControls = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'floorplans/' + filename + '.json')), 'utf-8');
    return defaultContentControls.controls;
};

//----------------------------------------------- File Exploring functions ---------------------------------------------

var getFilePath = function (viewName, suffix) {
    var filePath = '';
    //this is the name of a generic view
    if (viewName.indexOf('sap.suite.ui.generic.template') === 0) {
        filePath = viewName.substring(30);
        filePath = filePath.replace(/\./g, '/');
    }
    else {
        filePath = viewName;
    }
    if (suffix) {
        filePath = filePath + suffix;
    }
    if (rootPath) {
        filePath = rootPath + filePath;
    }
    return filePath;
};

var getDesignTemplateFragment = function (fragmentName) {
    var templateFilePath = getFilePath(fragmentName, '.fragment.xml');
    var patternified = [];
    var templateFile = _.find(libFiles, {name: templateFilePath});
    if (templateFile) {
        var templateContent = templateFile.asText();
        viewParser.parseView(path.basename(templateFilePath, '.hbs'), templateContent.toString(), function (data) {
            var cleanedData = [];
            cleanData(data.controls, cleanedData, {});
            patternify(cleanedData, patternified, []);
            postProcessTemplate(patternified);
            importFragmentsInDesignTemplate(patternified);
        });
    }
    return patternified;
};

var importFragmentsInDesignTemplate = function (DesignTree) {
    var fragmentName, templateContext, subDT, groupName;
    _.each(DesignTree, function (pattern) {
        if (pattern.groups && pattern.groups.fragments) {
            fragmentName = pattern.groups.fragments.fragmentName;
            templateContext = pattern.groups.fragments.template;
            subDT = getDesignTemplateFragment(fragmentName);
            _.each(subDT, function (fragmentControl) {
                if (!fragmentControl.template) {
                    fragmentControl.template = {};
                }
                fragmentControl.template = _.merge(fragmentControl.template, _.clone(templateContext));
                groupName = fragmentControl.type.charAt(0).toLowerCase() + fragmentControl.type.slice(1) + 's';
                pattern.groups[groupName] = fragmentControl;
            });
            delete pattern.groups.fragments;
        }
        else if (pattern.fragmentName) {
            fragmentName = pattern.fragmentName;
            templateContext = pattern.template;
            subDT = getDesignTemplateFragment(fragmentName);
            _.each(subDT, function (fragmentControl) {
                if (!fragmentControl.template) {
                    fragmentControl.template = {};
                }
                fragmentControl.template = _.merge(fragmentControl.template, _.clone(templateContext));
                groupName = fragmentControl.type.charAt(0).toLowerCase() + fragmentControl.type.slice(1) + 's';
                DesignTree.push(fragmentControl);
            });
        }
        importFragmentsInDesignTemplate(_.values(pattern.groups));
    });
    _.forEachRight(DesignTree, function (pattern, key) {
        if (pattern && pattern.fragmentName) {
            DesignTree.splice(key, 1);
        }
    });
};


var parseView = function (templateFile, suffix, fnCallBack) {
    if (templateFile.name.indexOf('.xml') === (templateFile.name.length - 4) && templateFile.name.indexOf('.json') === -1) {
        var templateContent = templateFile.asText();
        viewParser.parseView(path.basename(templateFile.name, '.hbs'), templateContent.toString(), function (data) {
            var cleanedData = [];
            cleanData(data.controls, cleanedData, {});

            // Rewrite using patterns
            var patternified = [];
            patternify(cleanedData, patternified, []);
            postProcessTemplate(patternified);
            importFragmentsInDesignTemplate(patternified);
            if (fnCallBack) {
                fnCallBack(patternified);
            }
        });
    }
};

/** Method use to populate the diffName property for each control
 *
 * The following table give the value of the non-bindable property
 * for each control
 *
 * -----------------------------------------------------------|
 |         template            |   Control        |   Property      |
 |--------------------------|---------------|-----------------|
 |ListReport                |Filter Bar        |None             |
 |ListReport                |Filter            |Description      |
 |ListReport or ObjectPage    |Table            |Title            |
 |ListReport or ObjectPage    |Action Button    |Label            |
 |ListReport or ObjectPage    |Column            |Title            |
 |ObjectPage                |Header            |None             |
 |ObjectPage                |KPI            |Title            |
 |ObjectPage                |Section        |Title            |
 |ObjectPage                |Form            |None             |
 |ObjectPage                |Form Group        |Title            |
 |ObjectPage                |Form Element    |Label            |
 |------------------------------------------------------------|
 * retrieves the defaultDifferentiatingName for different type of control
 * @param controlType
 * @returns {string}
 */
var defaultDifferentiatingName = function (controlType) {
    var differentiatingName = '';
    switch (controlType) {
        case 'Filter':
            differentiatingName = 'Description';
            break;
        case 'Table':
            differentiatingName = 'Title';
            break;
        case 'ActionButton':
            differentiatingName = 'Label';
            break;
        case 'Column':
            differentiatingName = 'Title';
            break;
        case 'KPI':
            differentiatingName = 'Title';
            break;
        case 'Section':
            differentiatingName = 'Title';
            break;
        case 'FormGroup':
            differentiatingName = 'Title';
            break;
        case 'FormElement':
            differentiatingName = 'Label';
            break;
        default:
            differentiatingName = '';
    }
    return differentiatingName;
};

var exploreAndExtract = function (smartTemplateLibFiles, catalog) {
    _.each(smartTemplateLibFiles, function (file) {

        if (file.name.indexOf('.view.xml') === (file.name.length - 9)) {
            //this is a smartTemplate view
            var addFloorPlan = function (designTemplate) {
                if (designTemplate && designTemplate.length > 0) {
                    var bIsValidView = false;
                    for (var i = 0; i < designTemplate.length; i++) {
                        // we check that the design template does not only contains fragment
                        if (!designTemplate[i].fragmentName) {
                            bIsValidView = true;
                            break;
                        }
                    }
                    if (bIsValidView) {
//                        var DTName = path.dirname(file.name).replace(/[\x2f]/gi, '.') + '.' + path.basename(file.name, '.view.xml');
                        var DTName = file.name.split('suite/ui/generic/template/')[1];
                        DTName = DTName.split('/view')[0];
                        catalog.floorPlans[DTName] = {
                            name: DTName,
                            isSmart: true,
                            description: DTName,
                            designTemplate: designTemplate[0],
                            templateName: 'sap.suite.ui.generic.template.' + DTName,
                            thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABQAAAAQAAQMAAACEXWYAAAAAA1BMVEX///+nxBvIAAAAtElEQVQYGe3BAQEAAACAkP6v7ggKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGIQeAAHYiJ6XAAAAAElFTkSuQmCC'
                        };
                    }
                }
            };
            parseView(file, null, addFloorPlan);
        }
    });
};

exports.extractCatalog = function (smartTemplateLibFiles, version) {
//    libFiles = smartTemplateLibFiles;
//    rootPath = smartTemplateLibFiles[0].name.split('sap/suite/ui/generic/template/')[0] + 'sap/suite/ui/generic/template/';
//    var catalog = {};
//    catalog.controls = {};
//    catalog.floorPlans = {};
//    exploreAndExtract(smartTemplateLibFiles, catalog);
//    postProcessCatalog(catalog);
//    addControlsInCatalog(catalog, version);

    //workaround since parsing it is still complicated
    var catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'SmartTemplateCatalog.json')), 'utf-8');
    return catalog;

};
