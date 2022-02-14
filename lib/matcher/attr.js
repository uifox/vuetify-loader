const { directives } = require('./generator')

module.exports = function match (_, { kebabAttr, camelAttr: attr }) {
  if (directives.includes(attr)) return [attr, `import ${attr} from '@uifox-at-doxo/vuetify/lib/directives/${kebabAttr}'`]
}
