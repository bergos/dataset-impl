const datasetFactory = {
  dataset: quads => new DatasetCore(quads, datasetFactory)
}

class DatasetCore {
  constructor (quads, { factory = datasetFactory } = {}) {
    // `_graphs` contains subject, predicate, and object indexes per graph
    this._graphs = Object.create(null)
    this._quads = new Map()
    // `_ids` maps entities such as `http://xmlns.com/foaf/0.1/name` to numbers,
    // saving memory by using only numbers as keys in `_graphs`
    this._id = 0
    this._ids = Object.create(null)
    this._ids['><'] = 0 // dummy entry, so the first actual key is non-zero
    this._entities = Object.create(null) // inverse of `_ids`

    this._factory = factory

    // Add quads if passed
    if (quads) {
      for (const quad of quads) {
        this.add(quad)
      }
    }
  }

  // ### `size` returns the number of quads in the store
  get size () {
    return this._quads.size
  }

  // ## Private methods

  // ### `__addToIndex` adds a quad to a three-layered index.
  // Returns if the index has changed, if the entry did not already exist.
  _addToIndex (index0, key0, key1, key2) {
    // Create layers as necessary
    const index1 = index0[key0] || (index0[key0] = Object.create(null))
    const index2 = index1[key1] || (index1[key1] = Object.create(null))
    // Setting the key to _any_ value signals the presence of the quad
    const existed = key2 in index2
    if (!existed) {
      index2[key2] = null
    }
    return !existed
  }

  // ### `__removeFromIndex` removes a quad from a three-layered index
  _removeFromIndex (index0, key0, key1, key2) {
    // Remove the quad from the index
    const index1 = index0[key0]
    const index2 = index1[key1]
    let key
    delete index2[key2]

    // Remove intermediary index layers if they are empty
    for (key in index2) return
    delete index1[key1]
    for (key in index1) return
    delete index0[key0]
  }

  // ### `__findInIndex` finds a set of quads in a three-layered index.
  // The index base is `index0` and the keys at each level are `key0`, `key1`, and `key2`.
  // Any of these keys can be undefined, which is interpreted as a wildcard.
  // `name0`, `name1`, and `name2` are the names of the keys at each level,
  // used when reconstructing the resulting quad
  // (for instance: _subject_, _predicate_, and _object_).
  // Finally, `graph` will be the graph of the created quads.
  // If `iteratee` is given, each result is passed through it
  // and iteration halts when it returns truthy for any quad.
  // If instead `array` is given, each result is added to the array.
  _findInIndex (index0, key0, key1, key2, name0, name1, name2, graph, iteratee, array) {
    // If a key is specified, use only that part of index 0.
    if (key0) {
      index0 = { [key0]: index0[key0] }
    }

    for (const value0 in index0) {
      let index1 = index0[value0]

      if (index1) {
        // If a key is specified, use only that part of index 1.
        if (key1) {
          index1 = { [key1]: index1[key1] }
        }

        for (const value1 in index1) {
          const index2 = index1[value1]

          if (index2) {
            // If a key is specified, use only that part of index 2, if it exists.
            const values = key2 ? (key2 in index2 ? [key2] : []) : Object.keys(index2)
            // Create quads for all items found in index 2.
            for (let l = 0; l < values.length; l++) {
              const mapIndex = {
                [name0]: value0,
                [name1]: value1,
                [name2]: values[l]
              }

              const quad = this._getQuad(mapIndex.subject, mapIndex.predicate, mapIndex.object, graph)

              if (array) {
                array.push(quad)
              } else if (iteratee(quad)) {
                return true
              }
            }
          }
        }
      }
    }

    return array
  }

  // ### `__getGraphs` returns an array with the given graph,
  // or all graphs if the argument is null or undefined.
  _getGraphs (graph) {
    if (typeof graph !== 'string') {
      return this._graphs
    }
    const graphs = {}
    graphs[graph] = this._graphs[graph]
    return graphs
  }

  // ### `_getQuads` returns an array of quads matching a pattern.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  _getQuads (subject, predicate, object, graph) {
    // Convert terms to internal string representation
    subject = DatasetCore.toId(subject)
    predicate = DatasetCore.toId(predicate)
    object = DatasetCore.toId(object)
    graph = DatasetCore.toId(graph)

    const quads = []
    const graphs = this._getGraphs(graph)
    let content

    const ids = this._ids
    let subjectId
    let predicateId
    let objectId

    // Translate IRIs to internal index keys.
    // Variables are assigned inside the if !!!
    if (typeof subject === 'string' && !(subjectId = ids[subject])) {
      return quads
    }

    if (typeof predicate === 'string' && !(predicateId = ids[predicate])) {
      return quads
    }

    if (typeof object === 'string' && !(objectId = ids[object])) {
      return quads
    }

    for (const graphId in graphs) {
      // Only if the specified graph contains triples, there can be results
      content = graphs[graphId]
      if (content) {
        // Choose the optimal index, based on what fields are present
        if (subjectId) {
          if (objectId) {
            // If subject and object are given, the object index will be the fastest
            this._findInIndex(content.objects, objectId, subjectId, predicateId, 'object', 'subject', 'predicate', graphId, null, quads)
          } else {
            // If only subject and possibly predicate are given, the subject index will be the fastest
            this._findInIndex(content.subjects, subjectId, predicateId, null, 'subject', 'predicate', 'object', graphId, null, quads)
          }
        } else if (predicateId) {
          // If only predicate and possibly object are given, the predicate index will be the fastest
          this._findInIndex(content.predicates, predicateId, objectId, null, 'predicate', 'object', 'subject', graphId, null, quads)
        } else if (objectId) {
          // If only object is given, the object index will be the fastest
          this._findInIndex(content.objects, objectId, null, null, 'object', 'subject', 'predicate', graphId, null, quads)
        } else {
          // If nothing is given, iterate subjects and predicates first
          this._findInIndex(content.subjects, null, null, null, 'subject', 'predicate', 'object', graphId, null, quads)
        }
      }
    }
    return quads
  }

  // ### `_forEach` executes the iteratee on all quads.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  _forEach (iteratee, subject, predicate, object, graph) {
    this._some(function (quad) {
      iteratee(quad)
      return false
    }, subject, predicate, object, graph)
  }

  // ### `_every` executes the iteratee on all quads,
  // and returns `true` if it returns truthy for all them.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  _every (iteratee, subject, predicate, object, graph) {
    let some = false
    const every = !this._some(function (quad) {
      some = true
      return !iteratee(quad)
    }, subject, predicate, object, graph)
    return some && every
  }

  // ### `some` executes the iteratee on all quads,
  // and returns `true` if it returns truthy for any of them.
  // Setting any field to `undefined` or `null` indicates a wildcard.
  _some (iteratee, subject, predicate, object, graph) {
    // Convert terms to internal string representation
    subject = DatasetCore.toId(subject)
    predicate = DatasetCore.toId(predicate)
    object = DatasetCore.toId(object)
    graph = DatasetCore.toId(graph)

    const graphs = this._getGraphs(graph)

    const ids = this._ids
    let subjectId
    let predicateId
    let objectId

    // Translate IRIs to internal index keys.
    // Variables are assigned inside the if !!!
    if (typeof subject === 'string' && !(subjectId = ids[subject])) {
      return false
    }

    if (typeof predicate === 'string' && !(predicateId = ids[predicate])) {
      return false
    }

    if (typeof object === 'string' && !(objectId = ids[object])) {
      return false
    }

    for (const graphId in graphs) {
      // Only if the specified graph contains triples, there can be results
      const content = graphs[graphId]

      if (!content) {
        continue
      }

      // Choose the optimal index, based on what fields are present
      if (subjectId) {
        if (objectId) {
          // If subject and object are given, the object index will be the fastest
          if (this._findInIndex(content.objects, objectId, subjectId, predicateId, 'object', 'subject', 'predicate', graphId, iteratee, null)) {
            return true
          }
        } else if (this._findInIndex(content.subjects, subjectId, predicateId, null, 'subject', 'predicate', 'object', graphId, iteratee, null)) {
          // If only subject and possibly predicate are given, the subject index will be the fastest
          return true
        }
      } else if (predicateId) {
        // If only predicate and possibly object are given, the predicate index will be the fastest
        if (this._findInIndex(content.predicates, predicateId, objectId, null, 'predicate', 'object', 'subject', graphId, iteratee, null)) {
          return true
        }
      } else if (objectId) {
        // If only object is given, the object index will be the fastest
        if (this._findInIndex(content.objects, objectId, null, null, 'object', 'subject', 'predicate', graphId, iteratee, null)) {
          return true
        }
      } else if (this._findInIndex(content.subjects, null, null, null, 'subject', 'predicate', 'object', graphId, iteratee, null)) {
        // If nothing is given, iterate subjects and predicates first
        return true
      }
    }

    return false
  }

  // quad set, get and delete

  _getQuad (subjectId, predicateId, objectId, graphId) {
    return this._quads.get(`${graphId}:::${subjectId}::${predicateId}::${objectId}`)
  }

  _setQuad (quad, subjectId, predicateId, objectId, graphId) {
    this._quads.set(`${graphId}:::${subjectId}::${predicateId}::${objectId}`, quad)
  }

  _deleteQuad (subjectId, predicateId, objectId, graphId) {
    this._quads.delete(`${graphId}:::${subjectId}::${predicateId}::${objectId}`)
  }

  // DatasetCore interface

  add (quad) {
    // Convert terms to internal string representation
    const graph = DatasetCore.toId(quad.graph)
    const object = DatasetCore.toId(quad.object)
    const predicate = DatasetCore.toId(quad.predicate)
    const subject = DatasetCore.toId(quad.subject)

    // Find the graph that will contain the triple
    let graphItem = this._graphs[graph]

    // Create the graph if it doesn't exist yet
    if (!graphItem) {
      graphItem = this._graphs[graph] = { subjects: {}, predicates: {}, objects: {} }

      // Freezing a graph helps subsequent `add` performance,
      // and properties will never be modified anyway
      Object.freeze(graphItem)
    }

    // Since entities can often be long IRIs, we avoid storing them in every index.
    // Instead, we have a separate index that maps entities to numbers,
    // which are then used as keys in the other indexes.
    const ids = this._ids
    const entities = this._entities
    const subjectId = ids[subject] || (ids[entities[++this._id] = subject] = this._id)
    const predicateId = ids[predicate] || (ids[entities[++this._id] = predicate] = this._id)
    const objectId = ids[object] || (ids[entities[++this._id] = object] = this._id)

    this._addToIndex(graphItem.subjects, subjectId, predicateId, objectId)
    this._addToIndex(graphItem.predicates, predicateId, objectId, subjectId)
    this._addToIndex(graphItem.objects, objectId, subjectId, predicateId)

    this._setQuad(quad, subjectId, predicateId, objectId, graph)

    return this
  }

  delete (quad) {
    // Convert terms to internal string representation
    let subject = DatasetCore.toId(quad.subject)
    let predicate = DatasetCore.toId(quad.predicate)
    let object = DatasetCore.toId(quad.object)
    const graph = DatasetCore.toId(quad.graph)

    // Find internal identifiers for all components
    // and verify the quad exists.
    let graphItem
    const ids = this._ids
    const graphs = this._graphs
    let subjects
    let predicates
    if (!(subject = ids[subject]) || !(predicate = ids[predicate]) ||
      !(object = ids[object]) || !(graphItem = graphs[graph]) ||
      !(subjects = graphItem.subjects[subject]) ||
      !(predicates = subjects[predicate]) ||
      !(object in predicates)) {
      return this
    }

    // Remove it from all indexes
    this._removeFromIndex(graphItem.subjects, subject, predicate, object)
    this._removeFromIndex(graphItem.predicates, predicate, object, subject)
    this._removeFromIndex(graphItem.objects, object, subject, predicate)
    this._deleteQuad(subject, predicate, object, graph)

    // Remove the graph if it is empty
    for (subject in graphItem.subjects) return this
    delete graphs[graph]
    return this
  }

  has (quad) {
    return this._getQuads(quad.subject, quad.predicate, quad.object, quad.graph).length > 0
  }

  match (subject, predicate, object, graph) {
    return this._factory.dataset(this._getQuads(subject, predicate, object, graph))
  }

  [Symbol.iterator] () {
    return this._quads.values()
  }

  static toId (term) {
    if (!term) {
      return null
    }

    let datatypeOrLanguage = ''

    switch (term.termType) {
      case 'NamedNode': return term.value
      case 'BlankNode': return `_:${term.value}`
      case 'Variable': return `?${term.value}`
      case 'DefaultGraph': return ''
      case 'Literal':
        if (term.datatype && term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
          datatypeOrLanguage = `^^${term.datatype.value}`
        }

        if (term.language) {
          datatypeOrLanguage = `@${term.language}`
        }

        return `"${term.value}"${datatypeOrLanguage}`
      default: throw new Error(`Unexpected termType: ${term.termType}`)
    }
  }
}

module.exports = DatasetCore
