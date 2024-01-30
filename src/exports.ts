/* eslint-disable antfu/no-cjs-exports */
import path from 'node:path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import fs from 'fs-extra'
import enhancedResolve from 'enhanced-resolve'

/**
 * Parses code to return all named (and default exports)
 * as well as `export * from` locations
 */
function getExportsDetails(code: string) {
  const ast = parse(code, {
    sourceType: 'module',
    allowUndeclaredExports: true,
    plugins: ['exportDefaultFrom'],
  })

  const exportAllLocations = []
  let exportsList = []

    ;(traverse.default || traverse)(ast, {
    ExportNamedDeclaration(path) {
      const { specifiers, declaration } = path.node
      exportsList = exportsList.concat(
        specifiers.map(specifier => specifier.exported.name),
      )

      if (declaration) {
        if (declaration.declarations) {
          declaration.declarations.forEach((dec) => {
            if (dec.id.type === 'ObjectPattern') {
              exportsList = exportsList.concat(
                dec.id.properties.map(property => property.value.name),
              )
            }
            else if (dec.id.type === 'Identifier') {
              exportsList.push(dec.id.name)
            }
          })
        }
        else if (declaration.id) {
          exportsList.push(declaration.id.name)
        }
      }
    },

    ExportDefaultDeclaration() {
      exportsList.push('default')
    },

    ExportAllDeclaration(path) {
      exportAllLocations.push(path.node.source.value)
    },
  })

  return {
    exportAllLocations,
    exports: exportsList,
  }
}

const resolver = enhancedResolve.create.sync({
  extensions: [
    '.web.mjs',
    '.mjs',
    '.web.js',
    '.js',
    '.mjs',
    '.json',
  ],
  modules: ['node_modules'],
  conditionNames: ['import', 'require'],
  mainFields: ['module', 'main'],
})

function resolveLocal(context: string, entryPoint?: string) {
  const pkg = JSON.parse(fs.readFileSync(path.join(context, 'package.json'), 'utf-8'))
  let entryPointPath

  if (entryPoint) {
    const entryPointMeta = pkg.exports?.[`./${entryPoint}`]
    if (entryPointMeta) {
      entryPointPath = typeof entryPointMeta === 'string'
        ? entryPointMeta
        : entryPointMeta.import || entryPointMeta.default
    }
  }
  else {
    entryPointPath = pkg.module || pkg.main
  }

  if (entryPointPath)
    return path.join(context, entryPointPath)
}

/**
 * Recursively get all exports starting
 * from a given path
 */
export async function getAllExports(
  context: string,
  lookupPath: string,
  isLocal?: boolean,
  localEntryPoint?: string,
): Promise<Record<string, string>> {
  const visited = new Set()

  const getAllExportsRecursive = async (ctx: string, lookPath: string, local?: boolean) => {
    const resolvedPath = local ? resolveLocal(ctx, localEntryPoint) : resolver(ctx, lookPath)

    if (!resolvedPath)
      return {}

    if (visited.has(resolvedPath))
      return {}

    visited.add(resolvedPath)

    const resolvedExports: Record<string, string> = {}
    const code = await fs.readFile(resolvedPath, 'utf8')
    const { exports, exportAllLocations } = getExportsDetails(code)

    exports.forEach((exp) => {
      resolvedExports[exp] = path.relative(context, resolvedPath)
    })

    const promises = exportAllLocations.map(async (location) => {
      const exports = await getAllExportsRecursive(
        path.dirname(resolvedPath),
        location,
      )
      Object.keys(exports).forEach((expKey) => {
        resolvedExports[expKey] = exports[expKey]
      })
    })

    await Promise.all(promises)
    return resolvedExports
  }

  const allExports = await getAllExportsRecursive(context, lookupPath, isLocal)
  return allExports
}
