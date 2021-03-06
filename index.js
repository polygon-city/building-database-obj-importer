var _ = require("lodash");
var argv = require("minimist")(process.argv.slice(2));
var inquirer = require("inquirer");
var glob = require("glob");
var LineReader = require("line-by-line");
var fs = require("fs");
var async = require("async");
var request = require("request");
require("request-debug")(request);

var proj4 = require("proj4");

var config;
var objPath;

if (!argv || (!argv.d && !argv.dir)) {
  console.log("Path to OBJ files must be provided via the -d or --dir flag.")
  process.exit(0);
} else {
  objPath = (argv.d) ? argv.d : argv.dir;
  console.log("OBJ path:", objPath);
}

// TODO: Set buildings as hidden until confirmed as correct
// TODO: Set buildings as visible using another script when happy
// TODO: Resume uploads after failure, even if script has crashed
// https://github.com/polygon-city/building-database-kml-importer/issues/2

// TODO: Fix ENOENT error where tmp files are deleted before being finished with
// TODO: Fix { error: "An error occurred during conversion" }

// For storing login session cookie
var cookieJar;
// Batch ID for upload
var batchID;
// Buildings to exclude from batch
var batchExclude;
var projection;
var creator;
var creatorURL;
var method;
var description;
var licenceType;

var questions = [
  {
    type: "input",
    name: "creator",
    message: "Who created this?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "creatorURL",
    message: "What URL was used to download the data?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "description",
    message: "How would you describe the data?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "projection",
    message: "What is the proj4js definition for the data?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "polygonCityURL",
    message: "What is the Polygon City URL?",
    default: function () { return "http://localhost:3000"; },
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "input",
    name: "polygonCityUser",
    message: "Which Polygon City username should be used?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "password",
    name: "polygonCityPass",
    message: "What is the password for that username?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String
  }, {
    type: "confirm",
    name: "batchContinue",
    message: "Do you want to continue from an existing batch?",
    default: false
  }, {
    type: "input",
    name: "batchID",
    message: "What is the batch ID to continue from?",
    validate: function(value) {
      var valid = (value.toString().length > 0);
      return valid || "Please enter a string";
    },
    filter: String,
    when: function(answers) {
      return answers.batchContinue;
    }
  }, {
    type: "list",
    name: "licenceType",
    message: "What licence is the data released under?",
    validate: function(value) {
      var valid = (value === "CC-BY" || value === "CC0");
      return valid || "Please select a valid licence";
    },
    filter: String,
    choices: ["CC0", "CC-BY"],
    default: 0
  }
];

var getConfig = function() {
  return function(cb) {
    process.nextTick(function() {
      fs.exists("./config.js", function(exists) {
        if (exists) {
          config = require("./config.js");
          cb(null);
        } else {
          inquirer.prompt(questions, function(answers) {
            config = answers;
            cb(null);
          });
        }
      });
    });
  };
};

var setVariables = function() {
  return function(cb) {
    process.nextTick(function() {
      // For storing login session cookie
      cookieJar = request.jar();

      // Batch ID for upload
      batchID = (config.batchID) ? config.batchID.toString() : "";

      // Buildings to exclude from batch
      batchExclude = [];

      // Projection
      projection = proj4.defs("importer", config.projection);

      creator = config.creator;
      creatorURL = config.creatorURL;
      method = "automated";
      description = config.description;

      if (config.licenceType) {
        licenceType = config.licenceType;
      }

      console.log(JSON.stringify(config, null, "  "));

      cb(null);
    });
  };
};

var checkConfig = function() {
  return function(cb) {
    process.nextTick(function() {
      // Check for required settings
      if (config) {
        var fail = false;

        if (!config.creator) {
          console.log("Required creator tag missing");
          fail = true;
        }

        if (!config.creatorURL) {
          console.log("Required creator URL tag missing");
          fail = true;
        }

        if (!config.description) {
          console.log("Required description tag missing");
          fail = true;
        }

        if (!config.projection) {
          console.log("Required projection missing");
          fail = true;
        }

        if (!config.polygonCityURL) {
          console.log("Required Polygon City URL missing");
          fail = true;
        }

        if (!config.polygonCityUser) {
          console.log("Required Polygon City username missing");
          fail = true;
        }

        if (!config.polygonCityPass) {
          console.log("Required Polygon City password missing");
          fail = true;
        }

        if (fail) {
          process.exit(1);
        } else {
          cb(null);
        }
      } else {
        console.log("Required config missing");
        process.exit(1);
      }
    });
  };
};

// Queue processing 10 buildings at a time
// TODO: POST building data: http://stackoverflow.com/a/25345124/997339
// TODO: Send location data POST request after successful file upload
var buildingQueue = async.queue(function(building, done) {
  var startTime = Date.now();

  var formData = {
    model: fs.createReadStream(building.model),
    creator: building.creator,
    creatorURL: building.creatorURL,
    method: building.method,
    description: building.description,
    // Leave original scale, assuming units are in metres already
    scale: 1,
    // No angle as model is already oriented
    angle: 0,
    latitude: building.latitude,
    longitude: building.longitude,
    batchID: building.batchID,
    batchBuildingRef: building.batchBuildingRef
  };

  if (licenceType) {
    formData.licenceType = licenceType;
  }

  request.post({
    url: config.polygonCityURL + "/api/buildings",
    jar: cookieJar,
    formData: formData
  }, function(err, res, body) {
    if (err) {
      // Skip on error
      // This is mostly the socket hangup error (issue #1) and often the
      // building has still been added successfully.
      //throw err;
      console.error(err);
      console.log("Skipping building");
      done();
      return;
    }

    // console.log("Status code:", res.statusCode);
    // console.log("Headers:");
    // console.log(res.headers);

    try {
      var savedBuilding = JSON.parse(body);

      // Skip on errors for now
      // Likely a line-by-line error which can be ignored
      // Though it does seem to cause some buildings not to successfully upload
      // TODO: Work out how to avoid this error entirely
      if (savedBuilding.error) {
        console.log("Skipping error:", savedBuilding.error);
        done();
        return;
      }

      // console.log("Building response:");
      // console.log(savedBuilding);

      var processTime = Date.now() - startTime;
      console.log("Processing: Slug ID " + savedBuilding.building.slug.id + " took " + processTime + " ms");

      done();
      return
    } catch(e) {
      console.log("Error parsing JSON:");
      console.log(body);
      done();
      return;
    }
  });
}, 10);

// Login to Polygon City
// TODO: Authenticate with something more robust like OAuth
var login = function() {
  return function (cb) {
    process.nextTick(function() {
      request.post({
        url: config.polygonCityURL + "/login",
        jar: cookieJar,
        form: {
          username: config.polygonCityUser,
          password: config.polygonCityPass
        }
      }, function(err, res, body) {
        if (err) {
          throw err;
        }

        console.log(body);

        // Hacky check to see if logged in
        if (body === "Moved Temporarily. Redirecting to /login") {
          cb(new Error("Login failed, check credentials are correct."));
          return;
        }

        console.log("Logged in username:", config.polygonCityUser);

        // TODO: Only callback if login was a success
        cb(null, body);
      });
    });
  };
};

var getBatchID = function(cb) {
  process.nextTick(function() {
    console.log("Requesting batch ID");

    request.get({
      url: config.polygonCityURL + "/api/batch/id",
      jar: cookieJar
    }, function(err, res, body) {
      if (err) {
        throw err;
      }

      var bodyJSON = JSON.parse(body);

      if (!bodyJSON || !bodyJSON.id) {
        cb(new Error("Unable to request batch ID"));
        return;
      }

      batchID = bodyJSON.id;

      console.log("Batch ID:", batchID);

      cb(null, batchID);
    });
  });
};

var getBatch = function(cb) {
  process.nextTick(function() {
    console.log("Requesting existing batch");

    if (!batchID) {
      cb(new Error("Batch ID not found"));
      return;
    }

    request.get({
      url: config.polygonCityURL + "/api/batch/" + batchID,
      jar: cookieJar
    }, function(err, res, body) {
      if (err) {
        throw err;
      }

      var bodyJSON = JSON.parse(body);
      batchExclude = bodyJSON;

      console.log("Batch ID:", batchID);
      console.log("Batch:", _.pluck(bodyJSON, "name"));

      cb(null, bodyJSON);
    });
  });
};

var readOBJDir = function(path) {
  return function (cb) {
    process.nextTick(function() {
      if (!batchID) {
        cb(new Error("Batch ID not found"));
        return;
      }

      glob(objPath + "**/*.obj", function (err, files) {
        if (err) {
          console.error(err);
          return;
        }

        // Queue file processing as not to cause EMFILE errors
        // https://github.com/polygon-city/building-database-obj-importer/issues/1
        var q = async.queue(processFile, 50);

        _.each(files, function(file) {
          q.push(file);
        });
      });
    });
  };
};

var processFile = function(file, cb) {
  var name = file.split(".obj")[0].split("/").pop();

  async.waterfall([function(callback) {
    getOrigin(file, function(err, origin) {
      var coords;
      try {
        coords = proj4("importer").inverse([origin[0], origin[2]]);
      } catch(err) {
        callback(err);
      }

      callback(null, coords);
    });
  }, function(coords, callback) {
    var exclude = _.find(batchExclude, function(building) {
      return (building.batch.buildingRef === name);
    });

    if (exclude) {
      console.log("Skipping building as already uploaded:", name);
      cb();
      return;
    }

    var output = {};

    output.model = file;
    output.creator = creator;
    output.creatorURL = creatorURL;
    output.method = method;
    output.description = description;
    output.latitude = coords[1],
    output.longitude = coords[0],
    output.batchID = batchID;
    output.batchBuildingRef = name;

    // Add building to queue
    buildingQueue.push(output);

    cb();
  }]);
}

var getOrigin = function(objFile, callback) {
  var lr = new LineReader(objFile);
  var re = /^# Origin: \((\d+\.?\d+)\,*\s*(\d+\.?\d+)\,*\s*(\d+\.?\d+)\)/i;

  lr.on("error", function(err) {
    lr.close();
    callback(err);
  });

  lr.on("line", function(line) {
    var results = re.exec(line);

    if (results) {
      callback(null, [Number(results[1]), Number(results[2]), Number(results[3])]);

      // TODO: Calling all of these may be overkill
      lr.pause();
      lr.end();
      lr.close();
    }
  });

  lr.on("end", function() {});
};

// TODO: Not working
var startBatch = function() {
  return function (cb) {
    process.nextTick(function() {
      var func = (batchID) ? getBatch : getBatchID;
      func(function(err) {
        cb(err)
      });
    });
  };
};

// TODO: Should this be a waterfall instead so the login cookie and batch ID can be passed along?
// TODO: If batch ID is provided on load, check current status and only upload buildings that haven"t been added (eg. that aren"t returned)
async.series([
  getConfig(),
  checkConfig(),
  setVariables(),
  login(),
  startBatch(),
  readOBJDir(objPath)
], function(err, results) {
  if (err) {
    throw err;
  }
});
