import {createServer} from 'node:http';
import worker from '../dist/server/index.js';

const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer between 1 and 65535.');
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url||'/',`http://127.0.0.1:${port}`);
  const result=await worker.fetch(new Request(url,{method:req.method,headers:req.headers}));
  res.writeHead(result.status,Object.fromEntries(result.headers));
  res.end(Buffer.from(await result.arrayBuffer()));
 }catch{
  res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
  res.end('The local app could not complete this request.');
 }
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`God Eye Berlin: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
