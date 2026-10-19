module.exports=function reasoningFixture(scope,values,conflict=false){
 const flow=new Set(['operating_profit','depreciation_amortization','interest_expense','net_revenue','cash_from_operations']);
 const variable=(id,key=null)=>({id,key,label:id,dimension:'money',nature:flow.has(key)?'duration':'instant',as_of:flow.has(key)?null:scope.end_date});
 const observation=(id,value,extra={})=>({id:'o_'+id,variable_id:id,value,label:id,raw_token:value,page:1,quote:id+' '+value,
   period_start:scope.start_date,period_end:scope.end_date,basis:scope.basis,currency:scope.currency,unit_multiplier:scope.unit_multiplier,dimension:'money',...extra});
 const variables=[],observations=[];
 for(const [key,value] of Object.entries(values))if(key!=='current_liabilities'){variables.push(variable('n_'+key,key));observations.push(observation('n_'+key,value));}
 variables.push(variable('long'),variable('subtotal'),variable('adjustment'),variable('current','current_liabilities'));
 observations.push(observation('long','35'),observation('adjustment','0'));
 if(conflict)observations.push(observation('n_total_liabilities','61',{id:'o_bad'}));
 const relation=(id,positive,negative)=>({id,label:id,kind:'identity',reason:'SYNTHETIC complete source partition',assumptions:[],evidence:[{page:1,quote:'SYNTHETIC '+id}],
  terms:[...positive.map(variable_id=>({variable_id,coefficient:'1'})),...negative.map(variable_id=>({variable_id,coefficient:'-1'}))]});
 return {version:'AIC-FINANCIAL-REASONING-1',variables,observations,relations:[relation('one',['n_total_liabilities'],['subtotal','long']),relation('two',['current'],['subtotal','adjustment'])],
  diagnostics:[],coverage:{pages_read:[1],pages_available:[1],complete:true}};
};
