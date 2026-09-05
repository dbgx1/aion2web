import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const guide = JSON.parse(readFileSync(new URL('../public/presence-provider-guide.json', import.meta.url), 'utf8'))
const source = readFileSync(new URL('../src/lib/presence-provider-doc.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const exports = {}
runInNewContext(outputText, { exports, require: name => {
  if (name !== '../../public/presence-provider-guide.json') throw new Error(`Unexpected dependency: ${name}`)
  return guide
} })
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true })
writeFileSync(new URL('../docs/PRESENCE_PROVIDER.md', import.meta.url), exports.providerGuideMarkdown())
console.log('Exported docs/PRESENCE_PROVIDER.md')
