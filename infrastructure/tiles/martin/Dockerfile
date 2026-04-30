FROM node:20-alpine

EXPOSE 10000

CMD ["sh", "-c", "node -e \"require('http').createServer((req,res)=>res.end('ok')).listen(10000,'0.0.0.0')\""]