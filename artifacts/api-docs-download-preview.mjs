import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
const built = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ApiDocsDownload} from './src/components/api-docs-download'; createRoot(document.getElementById('root')).render(<ApiDocsDownload/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [{name:'raw',setup(b){b.onLoad({filter:/\.(md|json)$/},a=>({contents:readFileSync(a.path.replace(/\?raw$/,''),'utf8'),loader:'text'}))}}], define: { 'process.env.NODE_ENV': '"production"' } })
createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(built.outputFiles[0].text)}
 res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><title>文档下载验证</title><div id="root"></div><script src="/app.js"></script>')
}).listen(4319,'127.0.0.1',()=>console.log('http://127.0.0.1:4319'))

