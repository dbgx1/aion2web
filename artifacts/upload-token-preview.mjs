import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
const built = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {UploadTokenDocs} from './src/components/upload-token-docs'; createRoot(document.getElementById('root')).render(<UploadTokenDocs/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' } })
const server = createServer((req,res) => {
  if(req.url === '/api/admin/upload-token') {
    res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','private, no-store');
    const denied = req.headers.referer?.includes('/denied');
    res.statusCode = denied ? 403 : 200;
    return res.end(JSON.stringify(denied ? {ok:false,error:'仅管理员可查看上传令牌'} : {ok:true,token:'preview-only-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'}));
  }
  if(req.url === '/app.js') {res.setHeader('Content-Type','text/javascript');return res.end(built.outputFiles[0].text)}
  const css=readFileSync('src/styles.css','utf8').replace(/@import[^;]+;/g,'')+readFileSync('src/components/upload-token-docs.css','utf8');
  res.setHeader('Content-Type','text/html');res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>上传令牌面板预览</title><style>${css}body{padding:24px;background:#edf2f1}main{max-width:1200px;margin:auto}</style><main><div id="root"></div></main><script src="/app.js"></script>`);
})
server.listen(4318,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4318 (test token only)'));
