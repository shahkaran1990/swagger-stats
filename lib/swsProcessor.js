/**
 * Created by sv2 on 2/18/17.
 * API usage statistics data
 */

// TODO Process res.statusMessage
// TODO Keep a list of most recent errors
// TODO Keep a list of most frequent errors

'use strict';

var util = require('util');

var swsUtil = require('./swsUtil');
var pathToRegexp = require('path-to-regexp');
var swsReqResStats = require('./swsReqResStats');
var swsCoreStats = require('./swsCoreStats');
var swsLastErrors = require('./swsLastErrors');
var swsLongestRequests = require('./swsLongestReq');

// Constructor
function swsProcessor() {

    // Core statistics
    this.coreStats = new swsCoreStats();

    // Last Errors
    this.lastErrors = new swsLastErrors();

    // Longest Requests
    this.longestRequests = new swsLongestRequests();

    // TODO API-specific detailed statistics

    // API matching indexes - maps route path to swagger api path
    // Format: { route_path: api_path }
    this.apiPathIndex = {};

    // API Base path per swagger spec
    this.basePath = '/';

    // Array of possible API path matches
    this.apiMatchIndex = {};
}

// Initialize
swsProcessor.prototype.init = function (swsOptions) {
    this.initializeAPI(swsOptions);
    this.coreStats.init();
    setInterval(this.tick, 500, this);
};

// Returns Core statistics
swsProcessor.prototype.getCoreStats = function () {
    return this.coreStats;
};

// Returns Last Errors
swsProcessor.prototype.getLastErrors = function () {
    return this.lastErrors;
};

// Returns Longest Requests
swsProcessor.prototype.getLongestReq = function () {
    return this.longestRequests.getData();
};

// Tick - called with specified interval to refresh timelines
swsProcessor.prototype.tick = function (that) {
    that.coreStats.tick();
    //that.coreStats.updateTimeline();
    //that.coreStats.updateRates();
    // TODO Update timelines in API stats
};

swsProcessor.prototype.initBasePath = function(swaggerSpec) {
    this.basePath = swaggerSpec.basePath ? swaggerSpec.basePath : '/';
    if (this.basePath.charAt(0) !== '/') {
        this.basePath = '/' + this.basePath;
    }
    if (this.basePath.charAt(this.basePath.length - 1) !== '/') {
        this.basePath = this.basePath + '/';
    }
};

// Get full swagger Path
swsProcessor.prototype.getFullPath = function (path) {
    var fullPath = this.basePath;
    if (path.charAt(0) === '/') {
        fullPath += path.substring(1);
    }else{
        fullPath += path;
    }
    return fullPath;
};

// Initialize API stats based on swagger definition
// Store data about API in a structure that will be easy to match when counting requests
// convert {param} to :param, so we can use path-to-regexp for matching
swsProcessor.prototype.initializeAPI = function (swsOptions) {

    if(!swsOptions) return;
    if(!swsOptions.swaggerSpec) return;

    this.initBasePath(swsOptions.swaggerSpec);

    if(!swsOptions.swaggerSpec.paths) return;


    // Enumerate all paths entries
    for(var path in swsOptions.swaggerSpec.paths ){

        console.log(path);
        var pathDef = swsOptions.swaggerSpec.paths[path];

        // Create full path
        var fullPath = this.getFullPath(path);

        // Convert to express path
        var fullExpressPath = fullPath.replace('{',':');
        fullExpressPath = fullExpressPath.replace('}','');

        // Create regex for matching this API path
        var keys = [];
        var re = pathToRegexp(fullExpressPath, keys);

        // Add to API Match Index, leveraging express style matching
        this.apiMatchIndex[fullPath] = { re: re, keys: keys, expressPath: fullExpressPath, methods: {}};
        console.log('   Added:' + fullPath + ' => ' + fullExpressPath );

        var operations = ['get','put','post','delete','options','head','patch'];
        for(var i=0;i<operations.length;i++){
            var op = operations[i];
            if(op in pathDef){
                console.log('   ' + op);
                var opDef = pathDef[op];
                var opMethod = op.toUpperCase();

                var apiInfo = {};       // Short API info for matching index
                var apiEntry = {};      // API Entry for statistics

                var depr = ('deprecated' in opDef) ? opDef.deprecated : false;
                apiEntry.deprecated = depr;
                apiInfo.deprecated = depr;

                if( 'description' in opDef ) apiEntry.description = opDef.description;
                if( 'operationId' in opDef ) {
                    apiEntry.operationId = opDef.operationId;
                    apiInfo.operationId = opDef.operationId;
                }

                apiEntry.stats = new swsReqResStats();

                if( 'summary' in opDef ) apiEntry.summary = opDef.summary;

                apiEntry.swagger = true;

                if( 'tags' in opDef ) {
                    apiEntry.tags = opDef.tags;
                    apiInfo.tags = opDef.tags;
                }

                // Store in match index
                this.apiMatchIndex[fullPath].methods[opMethod] = apiInfo;

                // Add addApiEntry to Core Stats definitions
                this.coreStats.addAPIEntry(fullPath,opMethod,apiEntry);
            }
        }
    }

};

// Collect all data for request/response pair
swsProcessor.prototype.collectRequestResponseData = function (res) {

    var req = res.req;

    var codeclass = swsUtil.getStatusCodeClass(res.statusCode);

    var reqresdata = {
        'url': req.url,
        'originalUrl': req.originalUrl,
        'method': req.method,
        'startts': 0,
        'endts': 0,
        'duration': 0,
        'codeclass': codeclass,
        'code': res.statusCode,
        'message': res.statusMessage
    };

    // Request Headers
    if ("headers" in req) {
        reqresdata.req_headers = {};
        for(var hdr in req.headers){
            reqresdata.req_headers[hdr] = req.headers[hdr];
        }
    }

    // Response Headers
    if ("_headers" in res){
        reqresdata.res_headers = {};
        for(var hdr in res['_headers']){
            reqresdata.res_headers[hdr] = res['_headers'][hdr];
        }
    }

    // Additional details from collected info per request / response pair
    if ("sws" in req) {

        reqresdata.startts = req.sws.startts;
        reqresdata.endts = req.sws.endts;
        reqresdata.duration = req.sws.duration;
        reqresdata.req_clength = req.sws.req_clength;
        reqresdata.res_clength = req.sws.res_clength;
        reqresdata.route_path = req.sws.route_path;

        // Add detailed swagger API info
        reqresdata.api = {};
        reqresdata.api.path = req.sws.api_path;
        if( 'swagger' in req.sws ) reqresdata.api.swagger = req.sws.swagger;
        if( 'deprecated' in req.sws ) reqresdata.api.deprecated = req.sws.deprecated;
        if( 'operationId' in req.sws ) reqresdata.api.operationId = req.sws.operationId;
        if( 'tags' in req.sws ) reqresdata.api.tags = req.sws.tags;

        // TODO Get additional attributes from coreStats (if any)
    }

    // TODO Body (?)
    // TODO Parameters
    // TODO Source IP address

    return reqresdata;
};

swsProcessor.prototype.matchRequest = function (req) {
    var url = req.originalUrl;
    for(var swPath in this.apiMatchIndex){
        if( this.apiMatchIndex[swPath].re.exec(url) ){
            if( req.method in this.apiMatchIndex[swPath].methods ){
                var apiInfo = this.apiMatchIndex[swPath].methods[req.method];
                req.sws.api_path = swPath;
                req.sws.swagger = true;
                if('deprecated' in apiInfo) req.sws.deprecated = apiInfo.deprecated;
                if('operationId' in apiInfo) req.sws.tags = apiInfo.tags;
                if('tags' in apiInfo) req.sws.tags = apiInfo.tags;
                return swPath;
            }else{
                return null;
            }
        }
    }
    return null;
};

swsProcessor.prototype.processRequest = function (req, res) {

    // Placeholder for sws-specific attributes
    req.sws = {};

    // Try to match to API right away
    this.matchRequest(req);

    // Count it in all stat collectors
    this.coreStats.countRequest(req, res);
};

swsProcessor.prototype.processResponse = function (res) {

    var req = res.req;

    // Capture route path for the request, if set by router
    var route_path = '';
    if (("route" in req) && ("path" in req.route)) {
        route_path = req.route.path;
    }
    req.sws.route_path = route_path;

    // If request was not matched to Swagger API, set API path:
    // Use route_path, if exist; if not, use originalUrl
    if(!('api_path' in req.sws)){
        req.sws.api_path = (route_path!=''?route_path:req.originalUrl);
    }

    // Pass through Core Statistics
    this.coreStats.countResponse(res);

    // Collect data about request / response
    var reqresdata = this.collectRequestResponseData(res);

    // Pass through last errors
    this.lastErrors.processReqResData(reqresdata);

    // Pass through longest request
    this.longestRequests.processReqResData(reqresdata);

    // TODO Push Request/Response Data to Emitter(s)
};


module.exports = swsProcessor;