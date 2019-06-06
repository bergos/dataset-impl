const Dataset = require('./lib/N3Store')

module.exports = function datasetFactory (quads = [], factory) {
  return new Dataset(quads, factory)
}
