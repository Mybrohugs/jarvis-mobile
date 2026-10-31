const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function view(error, hash = '', pathname = '/connect.html') {
  const elements = Object.fromEntries(['address','pairform','connect','message','code','open'].map(id=>[id,{}]));
  const calls=[];
  const context={document:{getElementById:id=>elements[id]},URLSearchParams,history:{replaceState(){}},window:{location:{origin:'https://pc.test.ts.net:8443',hash,pathname,search:''}},
    configured:()=>false,reachable:async()=>false,
    pair:async(url,code)=>{calls.push({url,code});if(error)throw new Error(error);}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('connect.js','utf8').replace(/^import .*;$/m,''),context);
  return {elements,calls};
}
test('dedicated pairing always targets the displayed current DEV origin',async()=>{
  const c=view();c.elements.code.value='123456';
  assert.equal(c.calls.length,0);
  await c.elements.pairform.onsubmit({preventDefault(){}});
  assert.deepEqual(c.calls,[{url:'https://pc.test.ts.net:8443',code:'123456'}]);
  assert.equal(c.elements.code.value,'');
  assert.equal(c.elements.pairform.hidden,true);
  assert.equal(c.elements.open.hidden,false);
});
test('closed pairing is explained without claiming success or retrying',async()=>{
  const c=view('pairing closed');
  await c.elements.pairform.onsubmit({preventDefault(){}});
  assert.match(c.elements.message.textContent,/Окно сопряжения/);
  assert.notEqual(c.elements.pairform.hidden,true);
  assert.equal(c.calls.length,1);
});

test('pairing link prefills only and never auto-submits',()=>{
  const c=view(undefined,'#code=123456');
  assert.equal(c.elements.code.value,'123456');
  assert.equal(c.calls.length,0);
});

test('standard HTTPS DEV path is preserved for pairing requests',async()=>{
  const c=view(undefined,'','/jarvis-dev/connect.html');
  c.elements.code.value='123456';
  await c.elements.pairform.onsubmit({preventDefault(){}});
  assert.equal(c.calls[0].url,'https://pc.test.ts.net:8443/jarvis-dev');
});
