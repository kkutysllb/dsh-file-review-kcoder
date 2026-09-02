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
import { pathToFileURL } from 'node:url'
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
ok('YAML 无裸 @ 值（patch 行，@ 为 anchor 保留字须引号）', !/:\s+@/.test(patch))
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

// ─── 行为回归：撤销按钮闪烁修复（v1.0.1）────────────────────────────────
// 产物是 window.__ModuleLoader__ 横幅的 CJS；node 下先垫 window 捕获工厂
// 返回值，再动态 import，直接检验真实发布物的行为不变量。
let frt = null
globalThis.window = {
  __ModuleLoader__: { load: ({ factory }) => { frt = factory(() => ({})) } },
}
try {
  await import(pathToFileURL(join(ROOT, 'lib', 'client.js')).href)
} catch (error) {
  ok('lib/client.js 可在 node 下加载', false, String(error))
}
ok('lib/client.js 导出 turnChangesFingerprint/inspectionKey',
  typeof frt?.turnChangesFingerprint === 'function' && typeof frt?.inspectionKey === 'function')

// ─── 行为回归：非代码产物分类与 bash 捕获（预览路由）──────────────────────
if (typeof frt?.classifyPath === 'function' && typeof frt?.captureArtifacts === 'function') {
  const { classifyPath, captureArtifacts } = frt
  ok('分类：图片/视频/音频/office/pdf/文档',
    classifyPath('a/b.PNG') === 'image' && classifyPath('x.mp4') === 'video'
    && classifyPath('y.flac') === 'audio' && classifyPath('r.docx') === 'office'
    && classifyPath('r.pdf') === 'pdf' && classifyPath('r.md') === 'doc')
  ok('分类：代码扩展名与无扩展名 → code',
    classifyPath('a/index.ts') === 'code' && classifyPath('Makefile') === 'code'
    && classifyPath('a.tar.gz') === 'code')
  const run = (cmd) => captureArtifacts('bash', JSON.stringify({ command: cmd }))
  ok('捕获：重定向生成图片',
    run('python plot.py > /dev/null && python gen.py > out/assets/hero.png').some(a => a.path === 'out/assets/hero.png'))
  ok('捕获：curl -o zip 不算产物、mp4 算',
    run('curl -sL -o pkg.zip https://x').length === 0
    && run('curl -sL -o demo.mp4 https://x').some(a => a.path === 'demo.mp4'))
  ok('捕获：mv/cp 末位参数',
    run('mv /tmp/shot.png assets/shot.png').some(a => a.path === 'assets/shot.png'))
  ok('捕获：tee 写 markdown',
    run('echo hi | tee note.md').some(a => a.path === 'note.md'))
  ok('捕获：引号目标去引号',
    run('curl -sL -o "out/clip 01.mp4" https://x').some(a => a.path === 'out/clip 01.mp4'))
  ok('捕获：纯代码命令零误报',
    run('node index.ts && npm run build').length === 0
    && run('echo hi > /dev/null').length === 0)
  ok('捕获：非 shell 工具不捕获',
    captureArtifacts('write', JSON.stringify({ file_path: 'a.png', content: 'x' })).length === 0)
}

if (typeof frt?.turnChangesFingerprint === 'function') {
  const { turnChangesFingerprint: fp, inspectionKey } = frt
  const own = (files) => ({ files })
  const faceWith = (turnDataMap) => ({
    legacy: { nodes: [], turnEnds: new Map() },
    timeline: {
      turnOrder: [3, 7],
      turns: new Map([
        [3, { turn: 3, status: 'closed', data: turnDataMap }],
        [7, { turn: 7, status: 'closed', data: new Map() }],
      ]),
    },
  })
  const dataA = new Map([
    ['fileReviewChanges', own([{ path: 'a.py', diffs: [1, 2] }, { path: 'b.py', diffs: [3] }])],
    ['deliverables', { produced: [{ seq: 5, path: 'a.py' }, { seq: 6, path: 'b.py' }] }],
  ])
  const face1 = faceWith(dataA)

  // 不变量一（闪烁根因）：快照引用更换但本 turn 内容未变 → 指纹必须相等。
  // 修复前的订阅以 face 引用为键，流式发布每次换引用 → 每张历史卡片不停重渲染。
  const face2 = faceWith(new Map([...dataA])) // 新 face、新 Map、同内容
  ok('指纹：引用更换+内容不变 → 相等（流式抖动免疫）',
    fp(face1, 3) === fp(face2, 3), `${fp(face1, 3)} vs ${fp(face2, 3)}`)

  // 不变量二：本 turn 内容变动（追加 hunk）→ 指纹必须变化。
  const face3 = faceWith(new Map([
    ['fileReviewChanges', own([{ path: 'a.py', diffs: [1, 2, 4] }, { path: 'b.py', diffs: [3] }])],
    ['deliverables', dataA.get('deliverables')],
  ]))
  ok('指纹：本 turn 追加 hunk → 变化', fp(face1, 3) !== fp(face3, 3))

  // 不变量三：turn 隔离——别的 turn 内容变动不影响本卡片。
  ok('指纹：其他 turn 变动 → 本 turn 指纹不变', fp(face1, 7) === fp(face3, 7))

  // 不变量四：deliverables 回退路径（own 无 files 时 derive 落到内置数据）。
  const face4 = faceWith(new Map([['deliverables', { produced: [{ seq: 5, path: 'a.py' }] }]]))
  const face5 = faceWith(new Map([['deliverables', { produced: [{ seq: 5, path: 'a.py' }, { seq: 9, path: 'c.py' }] }]]))
  ok('指纹：deliverables 回退追加 → 变化', fp(face4, 3) !== fp(face5, 3))
  ok('指纹：deliverables 回退同内容 → 相等', fp(face4, 3) === fp(faceWith(new Map([['deliverables', { produced: [{ seq: 5, path: 'a.py' }] }]])), 3))

  // 不变量五：无 timeline 的窗口回退以窗口形状为键（可过触发，不可漏触发）。
  const win1 = { legacy: { nodes: [1, 2], turnEnds: new Map([[3, 9]]) }, timeline: undefined }
  const win2 = { legacy: { nodes: [1, 2, 3], turnEnds: new Map([[3, 9]]) }, timeline: undefined }
  ok('指纹：窗口回退随窗口形状变化', fp(win1, 3) !== fp(win2, 3) && fp(win1, 3) === fp({ ...win1 }, 3))
  ok('指纹：null face → none', fp(null, 3) === 'none')

  // 巡检内容键：派生数组身份更换但内容相同 → 键相等；追加 hunk → 键变化。
  ok('inspectionKey：身份更换+同内容 → 相等',
    inspectionKey([{ path: 'a.py', diffs: [1] }]) === inspectionKey([{ path: 'a.py', diffs: [1] }]))
  ok('inspectionKey：追加 hunk → 变化',
    inspectionKey([{ path: 'a.py', diffs: [1] }]) !== inspectionKey([{ path: 'a.py', diffs: [1, 2] }]))
}

let fail = 0
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[smoke] ' + (checks.length - fail) + '/' + checks.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
