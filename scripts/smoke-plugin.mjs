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

// ─── 行为回归：轮尾链全量认领（dsh 0.1.5 交付物卡片兼容）────────────────
// dsh 0.1.5-alpha.2 起 `present` 工具把显式交付写进同一份 deliverables
// turn data（presented 字段），内置 ui-deliverables 行据此渲染交付卡片。
// 轮尾槽是 CHAIN：首个非 null 选择器独占该行。此前选择器只看 produced，
// 于是「既改文件又 present」的轮次会把新交付卡片整段吞掉（用户报的冲突）。
// 下列不变量锁住修复面：认领必须同时读取两个面，并由本插件渲染两段。
if (typeof frt?.selectDeliverables === 'function' && typeof frt?.presentedForClosing === 'function') {
  const { selectDeliverables, presentedForClosing } = frt
  const owner = (turnData) => ({ turn: { turn: 4, data: turnData }, seq: 90, openFile: () => {} })
  const delivered = (path, seq, index, description) => (
    description === undefined ? { path, seq, index } : { path, seq, index, description })
  const claimed = (turnData) => selectDeliverables(owner(turnData))

  // 冲突主案：produced 非空 + presented 非空 → 必须同时带回两段。
  const mixed = claimed(new Map([
    ['deliverables', { produced: [{ seq: 10, path: 'src/a.ts' }], presented: [delivered('out/report.html', 11, 0, '报告')] }],
  ]))
  ok('认领：produced+presented 同时带回（交付卡片不再被吞）',
    mixed !== null && mixed.produced.length === 1 && mixed.presented.length === 1
    && mixed.presented[0].path === 'out/report.html' && mixed.presented[0].description === '报告'
    && mixed.presented[0].seq === 11 && mixed.presented[0].index === 0)

  // 仅交付（bash 产物 + present，无 write/edit）→ 也必须认领，否则同一功能
  // 在轮次间出现两种行样式。
  const only = claimed(new Map([
    ['deliverables', { produced: [], presented: [delivered('out/hero.png', 12, 0)] }],
  ]))
  ok('认领：仅交付轮次同样认领（行样式一致）',
    only !== null && only.produced.length === 0 && only.presented.length === 1
    && only.presented[0].path === 'out/hero.png')

  ok('认领：空轮次让位（返回 null → 链上后续条目接手）',
    claimed(new Map([['deliverables', { produced: [], presented: [] }]])) === null
    && claimed(new Map()) === null)

  // closing seq 之后落地的交付属于下一轮，必须排除。
  ok('认领：closing seq 之后的交付被排除',
    presentedForClosing({ produced: [], presented: [delivered('late.md', 90, 0), delivered('early.md', 89, 0)] }, 90)
      .map(file => file.path).join(',') === 'early.md')

  // 同一路径重复 present → 位置取首次、描述取最新；畸形行丢弃。
  ok('认领：重复交付去重且描述取最新',
    presentedForClosing({
      produced: [],
      presented: [delivered('a.md', 5, 0, '旧'), delivered('b.md', 6, 0), delivered('a.md', 7, 1, '新')],
    }, 90).map(file => `${file.path}:${file.description ?? ''}`).join('|') === 'a.md:新|b.md:')
  ok('认领：畸形交付行被丢弃（不渲染坏坐标）',
    presentedForClosing({
      produced: [],
      presented: [delivered('ok.md', 5, 0), { path: '  ', seq: 5, index: 1 }, { path: 'x.md', seq: 5 },
        { path: 'y.md', seq: 5, index: 2, description: 7 }, null],
    }, 90).map(file => file.path).join(',') === 'ok.md')

  // 本插件自己的 Definition 数据优先，但仍要带回交付段。
  const own = claimed(new Map([
    ['fileReviewChanges', { files: [{ path: 'own.ts' }] }],
    ['deliverables', { produced: [{ seq: 10, path: 'builtin.ts' }], presented: [delivered('out.zip', 11, 0)] }],
  ]))
  ok('认领：自有 Definition 优先且保留交付段',
    own !== null && own.produced.join(',') === 'own.ts' && own.presented.length === 1)
}

// ─── 行为回归：原生侧边栏接管（changes-review 地址 → 本插件页签）──────────
// 产品铁律 1 的执行点（docs/ARCHITECTURE.md §12「不使用上游原生侧边栏功能」）：
// 上游 changed-files 卡的「审查」手势发 dsh-resource://changes-review/session/
// <id>/<seq>/<turn>，而 coding-sidebar 的文件打开门只认 dsh-resource://file/…
// 家族——没人认领就落回原生右栏，原生外壳被产品侧压制 → 用户看到的是一片空白。
if (typeof frt?.parseChangesReviewAddress === 'function') {
  const { parseChangesReviewAddress, wrapChangesReviewOpen } = frt
  const at = value => JSON.stringify(parseChangesReviewAddress(value))
  ok('接管：评审地址解析（含百分号编码的 Session id）',
    at('dsh-resource://changes-review/session/abc/42/7') === '{"sessionId":"abc","seq":42,"turn":7}'
    && at('dsh-resource://changes-review/session/s%2F1%20x/0/1') === '{"sessionId":"s/1 x","seq":0,"turn":1}')
  ok('接管：非评审地址一律不认领（文件族 / 段数 / 空 id / 非数字 / 坏转义 / 非字符串）',
    at('dsh-resource://file/session/abc/a.ts') === undefined
    && at('dsh-resource://changes-review/session/abc/42') === undefined
    && at('dsh-resource://changes-review/session/abc/42/7/extra') === undefined
    && at('dsh-resource://changes-review/session//42/7') === undefined
    && at('dsh-resource://changes-review/session/abc/x/7') === undefined
    && at('dsh-resource://changes-review/session/abc/42/0') === undefined
    && at('dsh-resource://changes-review/session/%E0%A4%A/42/7') === undefined
    && at(undefined) === undefined && at(null) === undefined && at(42) === undefined)
  if (typeof wrapChangesReviewOpen === 'function') {
    const original = []
    const right = { openResource(address, options) { original.push([address, options]) } }
    const before = right.openResource
    const claimed = []
    const dispose = wrapChangesReviewOpen(right, coordinates => { claimed.push(coordinates) })
    right.openResource('dsh-resource://changes-review/session/s1/5/3', { params: { index: 0 } })
    right.openResource('dsh-resource://file/session/s1/a.ts')
    ok('接管：评审地址被认领、其余地址原样透传',
      JSON.stringify(claimed) === '[{"sessionId":"s1","seq":5,"turn":3}]'
      && original.length === 1 && original[0][0] === 'dsh-resource://file/session/s1/a.ts')
    dispose()
    right.openResource('dsh-resource://changes-review/session/s1/5/3')
    ok('接管：dispose 还原原方法（HMR / 插件停用不留劫持）',
      right.openResource === before && original.length === 2)
    const inert = { openResource: undefined }
    const noop = wrapChangesReviewOpen(inert, () => {})
    ok('接管：服务无 openResource 时安全空转', typeof noop === 'function')
    noop()
  }
}

let fail = 0
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[smoke] ' + (checks.length - fail) + '/' + checks.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
