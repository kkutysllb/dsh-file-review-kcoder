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

let fail = 0
for (const [name, pass, detail] of results) {
  console.log((pass ? '  ✓ ' : '  ✗ ') + name + (pass || !detail ? '' : ' — ' + detail))
  if (!pass) fail++
}
console.log('[render] ' + (results.length - fail) + '/' + results.length + ' 项通过')
process.exit(fail === 0 ? 0 : 1)
