import { useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { providerGuide, providerGuideMarkdown } from '#/lib/presence-provider-doc'

export function PresenceApiDocs() {
  const [feedback, setFeedback] = useState('')
  function downloadGuide() {
    const url = URL.createObjectURL(new Blob([providerGuideMarkdown()], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'AION2-presence-provider.md'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function copyExample(value: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2))
      setFeedback('示例已复制')
    } catch {
      setFeedback('复制失败，请选择示例文本复制。')
    }
  }
  return (
    <section className="data-panel docs-endpoint-card" id="presence-mqtt">
      <div className="docs-endpoint-head">
        <div className="presence-doc-title">
          <div><h2>{providerGuide.title}</h2><p>协议 {providerGuide.version} · {providerGuide.updatedAt}</p></div>
          <button className="secondary-button" type="button" onClick={downloadGuide} title="下载提供方接入文档">
            <Download size={16} aria-hidden="true" />下载文档
          </button>
        </div>
        <p>{providerGuide.summary}</p>
        {feedback && <p role="status">{feedback}</p>}
      </div>
      <nav className="presence-doc-nav" aria-label="在线查询接入目录">
        {providerGuide.sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}
      </nav>
      {providerGuide.sections.map(section => (
        <div className="docs-spec-block presence-doc-section" id={section.id} key={section.id}>
          <h3>{section.title}</h3>
          {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          {section.columns && section.rows && (
            <div className="presence-doc-table-wrap">
              <table className="docs-table presence-doc-table">
                <thead><tr>{section.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
                <tbody>{section.rows.map(row => <tr key={row[0]}>{row.map((cell, index) => index === 0
                  ? <th scope="row" key={index}>{cell}</th>
                  : <td key={index}>{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {section.items && <ol className="presence-doc-list">{section.items.map(item => <li key={item}>{item}</li>)}</ol>}
          {section.examples?.map(example => (
            <div className="presence-doc-example" key={example.title}>
              <div className="presence-doc-example-head"><h4>{example.title}</h4>
                <button className="icon-button" type="button" onClick={() => void copyExample(example.json)}
                  title="复制 JSON 示例" aria-label={`复制：${example.title}`}><Copy size={16} aria-hidden="true" /></button>
              </div>
              <pre className="docs-code"><code>{JSON.stringify(example.json, null, 2)}</code></pre>
            </div>
          ))}
          {section.code && <pre className="docs-code"><code>{section.code}</code></pre>}
          {section.paragraphAfter && <p>{section.paragraphAfter}</p>}
        </div>
      ))}
    </section>
  )
}
