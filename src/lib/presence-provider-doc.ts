import guideData from '../../public/presence-provider-guide.json'

type GuideSection = {
  id: string
  title: string
  paragraphs?: string[]
  items?: string[]
  columns?: string[]
  rows?: string[][]
  examples?: { title: string; json: unknown }[]
  code?: string
  paragraphAfter?: string
}

export const providerGuide: { title: string; version: string; updatedAt: string; summary: string; sections: GuideSection[] } = guideData

export function providerGuideMarkdown() {
  return [
    `# ${providerGuide.title}`, `版本 ${providerGuide.version} · 更新 ${providerGuide.updatedAt}`, providerGuide.summary,
    ...providerGuide.sections.map(section => [
      `## ${section.title}`,
      ...(section.paragraphs || []),
      ...(section.columns && section.rows ? [[section.columns, section.columns.map(() => '---'), ...section.rows]
        .map(row => `| ${row.map(cell => cell.replaceAll('|', '\\|')).join(' | ')} |`).join('\n')] : []),
      ...(section.items ? [section.items.map((item, index) => `${index + 1}. ${item}`).join('\n')] : []),
      ...(section.examples || []).map(example => `### ${example.title}\n\n\`\`\`json\n${JSON.stringify(example.json, null, 2)}\n\`\`\``),
      ...(section.code ? [`\`\`\`text\n${section.code}\n\`\`\``] : []),
      ...(section.paragraphAfter ? [section.paragraphAfter] : []),
    ].join('\n\n')),
  ].join('\n\n') + '\n'
}
