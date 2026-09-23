#!/usr/bin/env node
/**
 * 轮尾行渲染冒烟（node scripts/smoke-render.mjs）——npm publish 前由
 * `pnpm smoke` 与 scripts/smoke-plugin.mjs 顺序执行，任何 FAIL 中断发布。
 *
 * 为什么需要渲染级校验：'conversation.chat.turnTail' 是 CHAIN 槽，选中即
 * 独占整行。插件的选择器一旦认领却少渲染一段，那一段就从对话里静默消失
 * ——dsh 0.1.5 的显式交付卡片（present）正是这样被吞掉过。纯函数级断言
 * （smoke-plugin.mjs 的认领不变量）只能证明「认领对了」，本脚本再证明
 * 「认领后两段都渲染出来了」。
 *
 * 实现方式：按 dsh 客户端的模块加载器横幅（window.__ModuleLoader__）加载
 * 真实发布物 lib/client.js，把 factory 的 require 接到本进程的 react /
 * react/jsx-runtime 上，用 react-dom/server 渲染整棵树并断言其 HTML。
 *
 * 唯一对渲染器让步：本插件与内置行的组件都没有声明 getServerSnapshot
 * （对话视图从不 SSR），故把客户端快照同时当作服务端快照；否则 React 18
 * 的 SSR 会直接抛错。这里只是把 hook 包一层，不改动发布物。
 */
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

let frt = null
const realUseSyncExternalStore = React.useSyncExternalStore
React.useSyncExternalStore = (subscribe, getSnapshot, getServerSnapshot) =>
  realUseSyncExternalStore(subscribe, getSnapshot, getServerSnapshot ?? getSnapshot)
const modules = { react: React, 'react/jsx-runtime': jsxRuntime }
globalThis.window = {
  __ModuleLoader__: {
    load: ({ factory }) => { frt = factory((id) => modules[id] ?? (() => { throw new Error('unexpected require: ' + id) })()) },
  },
}
await import(new URL('../lib/client.js', import.meta.url).href)

const zh = {
  'presented.summary': '交付文件', 'presented.action': '打开', 'presented.preview': '在侧边栏预览',
  'presented.previewCard': '在侧边栏预览 {name}', 'presented.previewButton': '在侧边栏打开 {name}',
  'presented.more': '{name} 的更多文件操作', 'presented.defaultApp': '用默认应用打开',
  'presented.finder': '在访达中显示', 'presented.explorer': '在资源管理器中显示',
  'presented.directory': '打开所在文件夹', 'presented.opening': '正在打开…', 'presented.opened': '已打开',
  'presented.error': '打开失败', 'presented.revealing': '显示中…', 'presented.revealed': '已显示',
  'presented.revealError': '显示失败', 'presented.directoryOpening': '打开文件夹…',
  'presented.directoryOpened': '已打开文件夹', 'presented.directoryError': '文件夹失败',
  'presented.nativeUnavailable': '无主机路径', 'presented.unavailable': '无桌面',
  'presented.hostError': '读桌面失败', 'presented.retry': '重试', 'presented.all': '全部 {count} 个文件',
  'presented.collapse': '收起', 'presented.expandAria': '展开 {count} 个', 'presented.collapseAria': '收起列表',
  'presented.file': '文件',
  'produced.edited': '已编辑 {count} 个文件', 'produced.editedOne': '已编辑 1 个文件',
  'produced.deletedOne': '已删除 1 个文件', 'produced.deletedAll': '已删除 {count} 个文件',
  'produced.reviewAll': '审查所有产出文件', 'produced.undo': '撤销', 'produced.redo': '重新应用',
  'produced.undoing': '正在撤销…', 'produced.redoing': '正在重新应用…',
  'produced.preview': '预览 {name}', 'produced.review': '审查 {name}', 'produced.open': '打开 {name}',
  'produced.deleted': '已删除', 'produced.noticeClose': '关闭提示', 'produced.noticeDismiss': '关闭',
  'produced.skippedFiles': '已跳过（{count} 个）', 'produced.kindImage': '图片', 'produced.kindVideo': '视频',
  'produced.kindAudio': '音频', 'produced.kindOffice': 'Office', 'produced.kindPdf': 'PDF', 'produced.kindDoc': '文档',
  'produced.undoSuccess': '已撤销', 'produced.redoSuccess': '已重做', 'produced.undoPartial': '部分未还原',
  'produced.redoPartial': '部分未重做', 'produced.undoPartialDescription': '部分出错', 'produced.redoPartialDescription': '部分出错',
  'produced.undoError': '撤销失败', 'produced.redoError': '重做失败', 'produced.toggleUnavailable': '无可还原',
  'review.title': '审查', 'review.stats': '新增 {added} 行，删除 {removed} 行',
}
const t = (key, params) => {
  const raw = zh[key] ?? key
  return raw.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
}
const noop = () => {}
const cardProps = (matched, extra = {}) => ({
  matched, sessionId: 's1', openFile: noop, turn: { turn: 4 }, t,
  collectReviews: () => [], openInSidebarTab: noop, openPreview: noop, ...extra,
})

const results = []
const check = (name, pass, detail = '') => results.push([name, pass, detail])
const render = (props) => renderToStaticMarkup(React.createElement(frt.Deliverables, props))

check('lib/client.js 导出 Deliverables 行组件', typeof frt?.Deliverables === 'function')

// 1. 冲突主案：既改文件又 present 的轮次 —— 两段必须同时渲染。
const mixed = render(cardProps({
  produced: ['src/a.ts'],
  presented: [{ path: 'out/report.html', description: '报告', seq: 11, index: 0 }],
}))
check('混合轮次：改动卡片渲染', mixed.includes('已编辑 1 个文件'))
check('混合轮次：交付卡片渲染（不再被认领吞掉）',
  mixed.includes('report.html') && mixed.includes('报告'))
check('混合轮次：交付段带行标记', mixed.includes('data-presented-files-row'))
check('混合轮次：单个交付占整行', mixed.includes('data-single="true"'))
check('混合轮次：预览与原生菜单入口齐备',
  mixed.includes('在侧边栏打开 out/report.html') && mixed.includes('out/report.html 的更多文件操作'))

// 2. 仅交付轮次（bash 产物 + present）：只渲染交付段。
const only = render(cardProps({ produced: [], presented: [{ path: 'out/hero.png', seq: 12, index: 0 }] }))
check('仅交付轮次：不渲染改动卡片', !only.includes('已编辑'))
check('仅交付轮次：无描述时副行为扩展名', only.includes('PNG'))

// 3. 超过 4 个交付默认折叠。
const many = render(cardProps({
  produced: [],
  presented: [1, 2, 3, 4, 5].map(n => ({ path: `f${n}.md`, seq: 20 + n, index: 0 })),
}))
check('交付 >4：折叠并给出展开入口', many.includes('全部 5 个文件') && !many.includes('f5.md'))
check('交付 >4：前四个已渲染', ['f1.md', 'f2.md', 'f3.md', 'f4.md'].every(n => many.includes(n)))

// 4. 描述尾部括号与内置卡片同规则剔除。
const trimmed = render(cardProps({ produced: [], presented: [{ path: 'r.pdf', description: '报告 (v2)', seq: 5, index: 0 }] }))
check('描述尾部括号剔除', trimmed.includes('报告') && !trimmed.includes('(v2)'))

// 5. 空匹配不渲染任何东西（让位给链上后续条目）。
check('空匹配 → 渲染空串', render(cardProps({ produced: [], presented: [] })) === '')

// 6. 控制器存在但主机信息未就绪：不崩，卡片照常渲染。
class FakeController {
  constructor() {
    const listeners = new Set()
    this.values = { state: {}, host: null }
    this.state = { getSnapshot: () => this.values.state, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) } }
    this.host = { getSnapshot: () => this.values.host, subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) } }
    this.loads = 0
  }
  loadHost() { this.loads += 1; return Promise.resolve() }
  open() { return Promise.resolve() }
}
const controller = new FakeController()
const withController = render(cardProps({ produced: [], presented: [{ path: 'x.md', seq: 5, index: 0 }] }, { presentedController: controller }))
check('控制器未就绪时仍渲染卡片', withController.includes('x.md'))

// 7. 0.1.7 共享文件动作子槽：卡片逐文件渲染它（dsh-file-review 1.0.9）。
// 宿主提供该槽内容时，动作位交给共享控件（用其它应用打开 / 显示文件位置）；
// owner props 逐字对齐 fork（actionUrl/available/pending/onAction），
// actionUrl 必须是本插件原生打开链路的那条路由。
const slotCalls = []
/** Controller fixture with a settled desktop answer (see FakeController above). */
const desktopController = ({ available, fileManager = 'finder' }) => {
  const fixture = new FakeController()
  fixture.values.host = { name: 'Host', available, fileManager }
  return fixture
}
// 占位贡献者：镜像 fork ui-open-in-app 的 FileRouteAction 期望（读 owner
// props、用 actionUrl 查应用清单、用 onAction 执行手势，桌面不可用时退场）。
const fakeRenderSlot = (key, owner, opts) => {
  slotCalls.push({ key, owner, hasFallback: opts?.fallback != null })
  if (!owner.available) return null
  return React.createElement('span', { 'data-file-action': 'contributed', 'data-action-url': owner.actionUrl },
    React.createElement('button', { type: 'button', 'data-open-target': 'file' }, '用 VS Code 打开'),
    React.createElement('button', { type: 'button', 'data-open-path-reveal': '' }, '显示文件位置'))
}
const slotProps = { fileActionsSlot: true, renderSlot: fakeRenderSlot }
const contributed = render(cardProps({
  produced: [], presented: [{ path: 'out/report.html', seq: 11, index: 0 }],
}, { presentedController: desktopController({ available: true }), ...slotProps }))
check('动作子槽：卡片逐文件渲染 deliverables.file.actions（key 正确、带 fallback）',
  slotCalls.length === 1 && slotCalls[0].key === 'deliverables.file.actions'
  && slotCalls[0].hasFallback === true)
check('动作子槽：宿主贡献的动作渲染进卡片',
  contributed.includes('data-file-action="contributed"') && contributed.includes('用 VS Code 打开')
  && contributed.includes('显示文件位置'))
check('动作子槽：actionUrl 指向本插件原生打开链路（Session 事件坐标）',
  slotCalls[0]?.owner?.actionUrl === 'api/present.open?sessionId=s1&seq=11&index=0',
  String(slotCalls[0]?.owner?.actionUrl))
check('动作子槽：owner props 形状逐字对齐 fork（available/pending/onAction）',
  slotCalls[0]?.owner?.available === true && slotCalls[0]?.owner?.pending === false
  && typeof slotCalls[0]?.owner?.onAction === 'function')

// 8. 手势转发：owner.onAction(action, application) 必须落到控制器的同一坐标 +
// application 参数（0.1.7 的「用其它应用打开」），并把失败种类回传给共享控件。
const opened = []
const hostReady = desktopController({ available: true })
hostReady.open = (sessionId, seq, index, action, application) => {
  opened.push([sessionId, seq, index, action, application ?? null])
  return Promise.resolve('openError')
}
render(cardProps({ produced: [], presented: [{ path: 'a.md', seq: 21, index: 2 }] }, { presentedController: hostReady, ...slotProps }))
const liveOwner = slotCalls[1].owner
const gestureOpen = await liveOwner.onAction('open', 'vscode')
const gestureReveal = await liveOwner.onAction('reveal')
check('动作子槽：onAction 透传坐标 + application（用其它应用打开）',
  JSON.stringify(opened) === JSON.stringify([['s1', 21, 2, 'open', 'vscode'], ['s1', 21, 2, 'reveal', null]]),
  JSON.stringify(opened))
check('动作子槽：onAction 回传失败种类给共享控件（fork 的 PresentedOpenFailure）',
  gestureOpen === 'openError' && gestureReveal === 'openError')
render(cardProps({ produced: [], presented: [{ path: 'b.md', seq: 22, index: 0 }] }, { ...slotProps, presentedController: undefined }))
check('动作子槽：无控制器时 onAction 安全返回 null（不抛）',
  (await slotCalls[2].owner.onAction('open')) === null)

// 9. 逐文件粒度 + 折叠不改变动作位：两个交付 → 两次渲染、坐标各自独立。
slotCalls.length = 0
render(cardProps({
  produced: [],
  presented: [{ path: 'one.md', seq: 31, index: 0 }, { path: 'two.md', seq: 32, index: 3 }],
}, slotProps))
check('动作子槽：逐文件渲染（两个交付 → 两次，坐标各自独立）',
  slotCalls.length === 2
  && slotCalls[0].owner.actionUrl === 'api/present.open?sessionId=s1&seq=31&index=0'
  && slotCalls[1].owner.actionUrl === 'api/present.open?sessionId=s1&seq=32&index=3')

// 10. 未声明子槽的注册（fileActionsSlot=false / 旧载具无 renderSlot）绝不调用
// renderSlot——对未声明的子键调用会被渲染器抛错并让整行退位——并保留自带控件。
slotCalls.length = 0
const undeclared = render(cardProps(
  { produced: [], presented: [{ path: 'c.md', seq: 41, index: 0 }] },
  { renderSlot: fakeRenderSlot },
))
check('动作子槽：未拿到声明时不调用 renderSlot，自带控件仍在',
  slotCalls.length === 0 && undeclared.includes('c.md 的更多文件操作')
  && !undeclared.includes('data-file-action="contributed"'))

// 11. 桌面不可用：owner.available=false，贡献者按 fork 的 FileRouteAction 退场
// （返回 null）——卡片自身照常渲染。
slotCalls.length = 0
const absent = render(cardProps(
  { produced: [], presented: [{ path: 'd.md', seq: 51, index: 0 }] },
  { presentedController: desktopController({ available: false }), ...slotProps },
))
check('动作子槽：桌面不可用时 available=false，贡献者退场也不影响卡片渲染',
  slotCalls.length === 1 && slotCalls[0].owner.available === false
  && absent.includes('d.md') && !absent.includes('data-file-action="contributed"'))

// 12. 手势进行中：pending=true 透传给共享控件（控件据此禁用按钮）。
slotCalls.length = 0
const pendingController = desktopController({ available: true })
// 状态键就是卡片交给共享控件的 actionUrl（本插件的原生打开路由）。
pendingController.values.state = { 'api/present.open?sessionId=s1&seq=61&index=0': 'opening' }
render(cardProps({ produced: [], presented: [{ path: 'e.md', seq: 61, index: 0 }] }, { presentedController: pendingController, ...slotProps }))
check('动作子槽：手势进行中 pending=true（共享控件禁用动作）',
  slotCalls.length === 1 && slotCalls[0].owner.pending === true)

let fail = 0
for (const [name, pass, detail] of results) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[render] ' + (results.length - fail) + '/' + results.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
