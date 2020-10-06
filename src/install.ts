import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs-extra'
import { getAllExports } from './exports'
import { parsePackage } from './utils'

export async function install(
  dir: string,
  pkg: string,
  clean = true,
  extra: string[] = [],
) {
  if (clean)
    await fs.remove(dir)

  await fs.ensureDir(dir)

  function run(cmd: string) {
    execSync(cmd, { cwd: dir })
  }

  const { name } = parsePackage(pkg)

  await fs.writeJSON(path.join(dir, 'package.json'), {
    type: 'module',
    private: true,
    dependencies: Object.fromEntries(
      [pkg, ...extra].map((i) => {
        const { name, version } = parsePackage(i)
        return [name, version]
      }),
    ),
  })
  run('npm i -s')

  const exports = await getAllExports(dir, name)

  return exports
}
