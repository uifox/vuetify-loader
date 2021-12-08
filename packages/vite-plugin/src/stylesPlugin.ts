import { utimes } from 'fs/promises'
import * as path from 'upath'
import _debug from 'debug'
import { cacheDir, writeStyles } from '@vuetify/loader-shared'

import type { PluginOption, ViteDevServer } from 'vite'
import type { Options } from '@vuetify/loader-shared'

const debug = _debug('vuetify:styles')

function isSubdir (root: string, test: string) {
  const relative = path.relative(root, test)
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const styleImportRegexp = /@use ['"]vuetify(\/lib)?\/styles(\/main(\.sass)?)?['"]/

export function stylesPlugin (options: Options): PluginOption {
  const vuetifyBase = path.dirname(require.resolve('vuetify/package.json'))
  const files = new Set<string>()

  let server: ViteDevServer
  let resolve: (v: any) => void
  let promise: Promise<any> | null
  let timeout: NodeJS.Timeout
  let pollTimeout: NodeJS.Timeout
  let needsTouch = false
  const blockingModules = new Set<string>()

  function getPendingModules () {
    return Object.entries(server._pendingRequests)
      .filter(([k, v]) => v != null)
      .map(([k]) => {
        const module = server.moduleGraph.urlToModuleMap.get(k)
        if (!module) {
          debug(`module not found: ${k}`)
        }
        return module?.id
      })
      .filter(Boolean) as string[]
  }

  function poll () {
    clearTimeout(pollTimeout)
    pollTimeout = setTimeout(() => {
      const pendingModules = getPendingModules()

      if (blockingModules.size === pendingModules.length && pendingModules.every(id => blockingModules.has(id))) {
        blockingModules.clear()
        clearTimeout(timeout)
        resolve(true)
      } else {
        debug('poll')
        poll()
      }
    }, 100)
  }

  async function awaitResolve (id?: string) {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      console.error('vuetify:styles fallback timeout hit', {
        blockingModules: Array.from(blockingModules.values()),
        pendingModules: getPendingModules(),
      })
      resolve(true)
    }, 500)

    if (id) {
      blockingModules.add(id)
    }

    poll()

    if (!promise) {
      promise = new Promise((_resolve) => resolve = _resolve)
      await promise
      debug('writing styles')
      await writeStyles(files)
      if (server && needsTouch) {
        server.moduleGraph.getModulesByFile(cacheDir('styles.scss'))?.forEach(module => {
          module.importers.forEach(module => {
            if (module.file) {
              debug(`touching ${module.file}`)
              utimes(module.file, Date.now(), Date.now())
            }
          })
        })
        needsTouch = false
      }
      promise = null
    }

    return promise
  }

  return {
    name: 'vuetify:styles',
    enforce: 'pre',
    configureServer (_server) {
      server = _server
    },
    async resolveId (source, importer, custom) {
      if (
        importer &&
        source.endsWith('.css') &&
        isSubdir(vuetifyBase, path.isAbsolute(source) ? source : importer)
      ) {
        if (options.styles === 'none') {
          return '__void__'
        } else if (options.styles === 'expose') {
          awaitResolve()

          const resolution = await this.resolve(
            source.replace(/\.css$/, '.sass'),
            importer,
            { skipSelf: true, custom }
          )

          if (resolution) {
            if (!files.has(resolution.id)) {
              needsTouch = true
              files.add(resolution.id)
            }

            return '__void__'
          }
        }
      }

      return null
    },
    async transform (code, id) {
      if (
        options.styles === 'expose' &&
        ['.scss', '.sass'].some(v => id.endsWith(v)) &&
        styleImportRegexp.test(code)
      ) {
        debug(`awaiting ${id}`)
        await awaitResolve(id)

        return code.replace(styleImportRegexp, '@use ".cache/vuetify/styles.scss"')
      }
    },
    load (id) {
      if (id === '__void__') {
        return ''
      }

      return null
    },
  }
}
