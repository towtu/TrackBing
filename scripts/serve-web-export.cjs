// Local verification server; not a production hosting implementation.
const http=require('http');const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'../dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.ttf':'font/ttf'};
function serveExport(port=0){return new Promise((resolve,reject)=>{
 const server=http.createServer((request,response)=>{
  try{
   const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
   let file=path.resolve(root,'.'+pathname);
   if((file!==root && !file.startsWith(root+path.sep)) || pathname.includes('\0')){response.writeHead(400);response.end();return;}
   if(pathname==='/')file=path.join(root,'index.html');
   else if(!path.extname(file) && fs.existsSync(file+'.html'))file+='.html';
   let status=200;
   if(!fs.existsSync(file) || !fs.statSync(file).isFile()){file=path.join(root,'404.html');status=404;}
   response.writeHead(status,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
   fs.createReadStream(file).on('error',()=>response.destroy()).pipe(response);
  }catch{response.writeHead(400);response.end();}
 });server.on('error',reject);server.listen(port,'127.0.0.1',()=>resolve({server,base:`http://127.0.0.1:${server.address().port}`}));
});}
module.exports={serveExport};
if(require.main===module)serveExport(8091).then(({base})=>console.log(base)).catch(error=>{console.error(error.message);process.exitCode=1;});
