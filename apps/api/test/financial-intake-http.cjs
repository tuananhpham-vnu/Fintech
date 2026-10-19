const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {Agent,getGlobalDispatcher,setGlobalDispatcher}=require('../node_modules/undici');
const {FinancialIntakeService}=require('../dist/financial/financial-intake.service');

test('local OCR response can outlast the default HTTP header budget',async()=>{
  const hash='a'.repeat(64);
  const server=http.createServer((req,res)=>{
    req.resume();
    setTimeout(()=>{
      res.writeHead(200,{'content-type':'application/json','X-AI-Mode':'live'});
      res.end(JSON.stringify({contract_version:'AIC-FINANCIAL-INTAKE-1',sha256:hash,page_count:1,
        document_type:'unknown',entity_name:null,tax_id:null,periods:[],period_issues:[],warnings:[],
        provenance:{model_id:'SYNTHETIC-local-ocr',prompt_version:'SYNTHETIC-v1'}}));
    },1500);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const original=getGlobalDispatcher();
  const shortDefault=new Agent({headersTimeout:50,bodyTimeout:50});
  setGlobalDispatcher(shortDefault);
  const base='http://127.0.0.1:'+server.address().port;
  try {
    await assert.rejects(fetch(base),error=>error.cause?.code==='UND_ERR_HEADERS_TIMEOUT');
    const service=new FinancialIntakeService({}, {documentAiMode:'live',aiServiceUrl:base,internalApiKey:'SYNTHETIC-only'}, {}, {});
    const result=await service.ai('discovery',{sha256:hash});
    assert.equal(result.provenance.model_id,'SYNTHETIC-local-ocr');
  } finally {
    setGlobalDispatcher(original);
    await shortDefault.destroy();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});
