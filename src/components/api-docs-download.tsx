import { Download } from 'lucide-react'
import markdown from '../../docs/AION2-API-FOR-AI.md?raw'
import json from '../../docs/AION2-API-FOR-AI.json?raw'

export function ApiDocsDownload() {
  function download(content: string, extension: string, mime: string) {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
    const link = document.createElement('a')
    link.href = url
    link.download = `AION2-API-FOR-AI.${extension}`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div style={{ display: 'grid', gap: 8 }}>
    <span className="docs-role-pill">核对更新：2026-10-01</span>
    <button className="secondary-button" type="button" onClick={() => download(markdown, 'md', 'text/markdown')}><Download size={16} aria-hidden="true" />下载完整文档（AI）</button>
    <button className="secondary-button" type="button" onClick={() => download(json, 'json', 'application/json')}><Download size={16} aria-hidden="true" />下载结构化 JSON</button>
    <small>下载文件使用凭据占位符</small>
  </div>
}
