#!/usr/bin/env node
/**
 * 插件形态冒烟（node scripts/smoke-plugin.mjs）——npm publish 前由
 * prepack 自动执行，任何 FAIL 中断发布。
 *
 * 包型产物校验面：main=lib/index.js、exports 面、cordis.patch.yml
 * name 指向、dsh.client.inject 的 coding-sidebar 依赖、peer optional
 * 声明、旧名零残留。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = 'dsh-file-review-kcoder'

const src = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null)
const checks = []
const ok = (name, pass, detail = '') => checks.push([name, pass, detail])

const pkgRaw = src('package.json')
ok('package.json 存在', pkgRaw !== null)
const pkg = pkgRaw ? JSON.parse(pkgRaw) : {}
ok('name == ' + PKG_NAME, pkg.name === PKG_NAME, String(pkg.name))
ok('version 合法', /^\d+\.\d+\.\d+$/.test(String(pkg.version)), String(pkg.version))
ok('main == lib/index.js', pkg.main === 'lib/index.js', String(pkg.main))
ok('exports["."] 声明', Boolean(pkg.exports?.['.']))
ok('exports["./client"] 声明', Boolean(pkg.exports?.['./client']))
ok('lib/index.js 存在', src('lib/index.js') !== null)
ok('lib/client.js 存在', src('lib/client.js') !== null)
ok('dsh.bundle.patch 声明', pkg.dsh?.bundle?.patch === './cordis.patch.yml')
const patch = src('cordis.patch.yml') ?? ''
ok('patch name 指向新包名', patch.includes("name: '" + PKG_NAME + "'") || patch.includes('name: "' + PKG_NAME + '"'))
const inject = JSON.stringify(pkg.dsh?.client?.inject ?? [])
ok('inject 含 dsh-coding-sidebar', inject.includes('dsh-coding-sidebar'), inject)
ok('peer dsh-coding-sidebar optional', pkg.peerDependencies?.['dsh-coding-sidebar'] !== undefined
  && pkg.peerDependenciesMeta?.['dsh-coding-sidebar']?.optional === true)

// 产物面旧名零容忍（package.json description 与 README 的 lineage
// 历史表述豁免——如同自立仓 README 提及血缘上游）
const legacy = ['@kcoder/file-review', 'dsh-better-sidebar']
let residue = []
for (const f of ['cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
  const s = src(f)
  if (s === null) continue
  for (const n of legacy) if (s.includes(n)) residue.push(f + ' → ' + n)
}
ok('产物面旧名零残留', residue.length === 0, residue.join('; '))

let fail = 0
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[smoke] ' + (checks.length - fail) + '/' + checks.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
