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

// ─── 行为回归：0.1.7 共享文件动作子槽（用其它应用打开 / 显示文件位置）──────
// dsh 0.1.7 把交付卡的原生动作位改成共享 list 子槽 deliverables.file.actions：
// 由认领轮尾行的条目声明（fork ui-deliverables index.ts:83），ui-open-in-app
// 向它贡献带应用清单的控件（fork ui-open-in-app index.ts:83-88）。KCoder 部署
// 关掉原生行（tailCard:false）后没有人声明该子槽 → 控件不出现。本插件既然
// 认领同一行，就必须在自己的 register children 里声明它。
//
// 断言面：注册选项真的带上 children（逐字对齐 fork 的 kind/scope）+ KCoder
// 共享渲染面开关；注册被拒（既有声明者且注册表不认该开关）时退回无 children
// 形态、不炸插件，并且 inject 面如实报告 fileActionsSlot=false——卡片据此
// 才不会对未声明的子键调用 renderSlot（那会被渲染器直接抛错）。
if (typeof frt?.apply === 'function') {
  const locales = { register: () => () => {}, getSnapshot: () => ({ active: 'zh' }) }
  const makeCtx = (register) => {
    const ctx = {
      locale: locales,
      effect: (fn) => fn(),
      on: () => () => {},
      remote: { $mount: () => Promise.resolve(() => {}) },
      get: (name) => (name === 'uiConversation' ? { events: { register: () => () => {} } } : undefined),
      inject: () => ({ dispose: () => {} }),
      betterSidebar: { registerTab: () => () => {} },
      sessions: { list: { getSnapshot: () => ({ byId: {} }) }, scope: () => undefined },
      slots: { inject: (key, contribute) => { contribute(); return () => {} }, register },
    }
    return ctx
  }
  const capture = () => {
    const entries = []
    const ctx = makeCtx((options, component) => { entries.push({ options, component }); return () => {} })
    frt.apply(ctx)
    return entries
  }
  const entries = capture()
  const declared = entries.find(entry => entry.options?.name === 'conversation.chat.turnTail')
  ok('动作子槽：轮尾行注册仍只有一条（id dsh-file-review-tab）',
    entries.length === 1 && declared !== undefined && declared.options.id === 'dsh-file-review-tab')
  ok('动作子槽：注册项声明 deliverables.file.actions（list / session，逐字对齐 fork）',
    declared !== undefined
    && JSON.stringify(declared.options.children?.['deliverables.file.actions'])
      === '{"kind":"list","scope":"session"}',
    JSON.stringify(declared?.options?.children))
  ok('动作子槽：带上共享渲染面开关（重复声明不致命，KCoder fork 的 rendersExistingChildren）',
    declared?.options?.rendersExistingChildren === true)
  ok('动作子槽：注册的组件是卡片组件', typeof declared?.component === 'function')
  const face = declared?.options?.inject?.('s1')
  ok('动作子槽：inject 面报告 fileActionsSlot=true（声明成功，卡片可 renderSlot）',
    face?.fileActionsSlot === true)
  ok('动作子槽：inject 面仍带回既有交付面（控制器 + 收窄/审查回调）',
    typeof face?.presentedController === 'object' && typeof face?.collectReviews === 'function'
    && typeof face?.openInSidebarTab === 'function' && typeof face?.openPreview === 'function'
    && face?.projectRoot === undefined)

  // 兜底：注册表不认该开关且子键已被声明（上游 tailCard 默认 true 的装配，
  // 或未带 KCoder 补丁的 0.1.7-alpha.1）→ register 抛错，插件必须退回无
  // children 的形态继续工作，而不是整行消失。诊断行同时收进数组：既是断言
  // 对象，也让这条预期内的一次性告警不出现在发布冒烟的输出里。
  const fallbackEntries = []
  const fallbackCtx = makeCtx((options, component) => {
    if (options?.children !== undefined) throw new Error('slot "deliverables.file.actions" is already declared (by ui-deliverables)')
    fallbackEntries.push({ options, component })
    return () => {}
  })
  let fallbackThrew = false
  const warnings = []
  const realWarn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  try {
    frt.apply(fallbackCtx)
  } catch (error) {
    fallbackThrew = true
  } finally {
    console.warn = realWarn
  }
  ok('动作子槽：重复声明被拒时不炸插件（退回无 children 注册）',
    fallbackThrew === false && fallbackEntries.length === 1
    && fallbackEntries[0]?.options?.children === undefined
    && warnings.some(message => message.includes('file-action child slot unavailable')),
    warnings.join(' | '))
  const fallbackFace = fallbackEntries[0]?.options?.inject?.('s1')
  ok('动作子槽：退回形态下 inject 面报告 fileActionsSlot=false（卡片只用自带控件）',
    fallbackFace?.fileActionsSlot === false)
}

// ─── 行为回归：原生打开路由的 application 参数（0.1.7 同款寻址）──────────
// 上游 0.1.7 的交付卡把应用选择编码进同一条 open 路由（fork ui-deliverables
// client/present-open.ts:133-134）：reveal 走 &action=reveal 且不带 application，
// 显式应用走 &application=<encodeURIComponent(id)>，无参调用保持原样。
// 不变量：新增参数不得改变历史无参调用的 URL 与返回语义。
if (typeof frt?.PresentedOpenController === 'function' && typeof frt?.presentedFileUrl === 'function') {
  const { PresentedOpenController, presentedFileUrl } = frt
  const calls = []
  const realFetch = globalThis.fetch
  let nextResponse = { ok: true, status: 204 }
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method })
    if (nextResponse instanceof Error) throw nextResponse
    return nextResponse
  }
  const respond = (response) => { nextResponse = response }
  try {
    ok('打开路由：URL 与原实现逐字一致',
      presentedFileUrl('s1', 2, 0) === 'api/present.open?sessionId=s1&seq=2&index=0',
      presentedFileUrl('s1', 2, 0))

    const controller = new PresentedOpenController()
    const baseline = presentedFileUrl('s1', 10, 0)
    ok('打开路由：无参调用（历史形态）不追加任何查询参数',
      (await controller.open('s1', 10, 0)) === null
      && calls.length === 1 && calls[0].url === baseline && calls[0].method === 'POST'
      && controller.state.getSnapshot()[baseline] === 'opened')

    respond({ ok: true, status: 204 })
    await controller.open('s1', 11, 0, 'reveal')
    ok('打开路由：reveal 走 &action=reveal',
      calls[1].url === `${presentedFileUrl('s1', 11, 0)}&action=reveal`
      && controller.state.getSnapshot()[presentedFileUrl('s1', 11, 0)] === 'revealed')

    respond({ ok: true, status: 204 })
    await controller.open('s1', 12, 0, 'open', 'vscode')
    ok('打开路由：显式应用走 &application=<id>',
      calls[2].url === `${presentedFileUrl('s1', 12, 0)}&application=vscode`)

    respond({ ok: true, status: 204 })
    await controller.open('s1', 13, 0, 'open', 'Visual Studio Code')
    ok('打开路由：application 值百分号编码',
      calls[3].url === `${presentedFileUrl('s1', 13, 0)}&application=Visual%20Studio%20Code`)

    respond({ ok: true, status: 204 })
    await controller.open('s1', 14, 0, 'reveal', 'vscode')
    ok('打开路由：reveal 忽略 application（与 fork 同规则）',
      calls[4].url === `${presentedFileUrl('s1', 14, 0)}&action=reveal`)

    respond({ ok: false, status: 422 })
    ok('打开失败：422（主机无该路径）报 openError 并留 nativeUnavailable 状态',
      (await controller.open('s1', 15, 0)) === 'openError'
      && controller.state.getSnapshot()[presentedFileUrl('s1', 15, 0)] === 'nativeUnavailable')

    respond({ ok: false, status: 500 })
    ok('打开失败：5xx 报 openError', (await controller.open('s1', 16, 0)) === 'openError')

    respond({ ok: false, status: 500 })
    ok('打开失败：reveal 失败报 revealError', (await controller.open('s1', 17, 0, 'reveal')) === 'revealError')

    respond(new Error('transport down'))
    ok('打开失败：传输异常报 openError（不是未捕获拒绝）',
      (await controller.open('s1', 18, 0)) === 'openError'
      && controller.state.getSnapshot()[presentedFileUrl('s1', 18, 0)] === 'error')

    respond({ ok: true, status: 204 })
    const pendingUrl = presentedFileUrl('s1', 19, 0)
    const first = controller.open('s1', 19, 0)
    const reentrant = controller.open('s1', 19, 0)
    const phaseDuring = controller.state.getSnapshot()[pendingUrl]
    ok('打开路由：同一坐标在手势进行中重入 → 不再发请求、返回 null',
      phaseDuring === 'opening' && (await reentrant) === null && (await first) === null
      && calls.filter(call => call.url === pendingUrl).length === 1)

    await controller.dispose()
    respond({ ok: true, status: 204 })
    ok('打开路由：dispose 后不再发请求、返回 null',
      (await controller.open('s1', 20, 0)) === null
      && calls.every(call => call.url !== presentedFileUrl('s1', 20, 0)))
  } finally {
    globalThis.fetch = realFetch
  }
}

let fail = 0
for (const [name, pass, detail] of checks) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[smoke] ' + (checks.length - fail) + '/' + checks.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
