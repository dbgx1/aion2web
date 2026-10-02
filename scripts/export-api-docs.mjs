import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const guide = JSON.parse(readFileSync('public/presence-provider-guide.json', 'utf8'))
const reference = readFileSync('docs/AION2-API-REFERENCE.md', 'utf8').trim()
const updatedAt = reference.match(/核对日期：(\d{4}-\d{2}-\d{2})/)?.[1]
if (!updatedAt) throw new Error('Missing API reference date')
const markdown = [
  `# ${guide.title}`, `版本 ${guide.version} · 更新 ${guide.updatedAt}`, guide.summary,
  ...guide.sections.map(section => [
    `## ${section.title}`, ...(section.paragraphs || []),
    ...(section.columns && section.rows ? [[section.columns, section.columns.map(() => '---'), ...section.rows]
      .map(row => `| ${row.map(cell => cell.replaceAll('|', '\\|')).join(' | ')} |`).join('\n')] : []),
    ...(section.items ? [section.items.map((item, index) => `${index + 1}. ${item}`).join('\n')] : []),
    ...(section.examples || []).map(example => `### ${example.title}\n\n\`\`\`json\n${JSON.stringify(example.json, null, 2)}\n\`\`\``),
    ...(section.code ? [`\`\`\`text\n${section.code}\n\`\`\``] : []),
    ...(section.paragraphAfter ? [section.paragraphAfter] : []),
  ].join('\n\n')),
].join('\n\n') + '\n'

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(join(dir, item.name)) : [join(dir, item.name)])
}
const routes = files('src/routes/api').filter(path => /\.tsx?$/.test(path)).sort().map(path => {
  const source = readFileSync(path, 'utf8')
  return {
    path: source.match(/createFileRoute\(['"]([^'"]+)['"]\)/)?.[1]?.replace(/\$([A-Za-z0-9_]+)/g, '{$1}'),
    methods: [...new Set([...source.matchAll(/\b(GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD):/g)].map(match => match[1]))],
    source: relative('.', path).replaceAll('\\', '/'),
  }
})
if (routes.some(route => !route.path || !route.methods.length)) throw new Error('Incomplete route inventory')
const inventory = [
  '# 附录：当前站点 HTTP 路由清单',
  '以下由路由源文件生成。正文未展开的 AI、聊天、客服和跟踪接口属于控制台内部功能，不能仅凭路径推测请求字段或权限。此清单不是 OpenAPI 规范；query.mmorpgchat.com 的独立调度器接口见在线查询章节。',
  ['| 方法 | 路径 |', '| --- | --- |', ...routes.map(route => `| ${route.methods.join(', ')} | \`${route.path}\` |`)].join('\n'),
].join('\n\n')
const combined = reference + '\n\n' + markdown + '\n' + inventory + '\n'
writeFileSync('docs/AION2-API-FOR-AI.md', combined)
writeFileSync('docs/AION2-presence-provider.md', markdown)
writeFileSync('docs/AION2-API-FOR-AI.json', JSON.stringify({
  title: 'AION2 接口参考', updatedAt, baseUrl: 'https://mmorpgchat.com',
  format: 'reference-bundle (not OpenAPI)', credentialsIncluded: false,
  referenceMarkdown: reference, presenceProtocol: guide, routeInventory: routes,
}, null, 2) + '\n')
console.log(`Exported AI reference: ${routes.length} HTTP routes, ${guide.sections.length} MQTT sections; credentials excluded`)
