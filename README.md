# Polygon City OBJ Importer

## Using batches

The concept of batched uploads is still very new and the approach is flimsy at best, though it works. It's important to know how to use batches otherwise you may end up duplicating buildings on Polygon City.

__If you're adding a new batch of buildings:__ make sure the `batchID` config string is empty and the importer will create a new batch on Polygon City.

__If you're continuing an existing batch:__ make sure the `batchID` config option is set to the ID string you received previously when uploading a new batch. This will ensure that only buildings not already added are uploaded. _Be sure this is correct as otherwise the buildings will be added to Polygon City again but using a different batch ID - they will be duplicated._

## Importing OBJ models into Polygon City

* Export some CityGML models into OBJ using [citygml-to-obj](https://github.com/polygon-city/citygml-to-obj)
* Open the directory for this repo and run `npm install`
* Approach 1: Using the config.js file (recommended)
  * Rename `config.sample.js` to `config.js` and update the settings
  * Run the script using `node index.js --dir /path/to/obj/directory`
* Approach 2: Using the terminal
  * Run `node index.js --dir /path/to/obj/directory` and follow the instructions
* Wait for it to finish - it can take a while
* [Re-run with the previous batch ID](#using-batches) should anything go wrong. It's worth doing this anyway as it serves as a check to ensure everything was added ok.
* Check the newly added buildings in Polygon City


## Notes

* This only works with OBJ files created using [citygml-to-obj](https://github.com/polygon-city/citygml-to-obj) due to the way origin data is stored
* Ensure that you define the projection in the config file or terminal setup as a proj4js definition string
 * eg. `"+proj=longlat +datum=WGS84 +no_defs"`
 * You can find out the proj4js definition from [epsg.io](http://epsg.io/)
