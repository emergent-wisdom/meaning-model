import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Execute the real start module and session coordinator with only the browser
// and renderer mounts replaced. Navigation throws; only history writes work.
const harness = `
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8')), startUrl=process.argv[1];
const actions=[],imports=[],errors=[],replacements=[],keys=[],toolbarStates=[],active=new Set(),controllers={},retained={},handlers={};
let address=new URL(input.url);
globalThis.window=globalThis; globalThis.innerHeight=788;
globalThis.addEventListener=(name,handler)=>(handlers[name]??=[]).push(handler);
globalThis.dispatchEvent=event=>{actions.push({kind:'event',type:event.type});for(const handler of handlers[event.type]??[])handler(event);};
globalThis.location={assign(){throw Error('Navigation forbidden');},reload(){throw Error('Reload forbidden');}};
for(const key of ['href','search','pathname','hash','origin']) Object.defineProperty(location,key,{get:()=>address[key],set:()=>{throw Error('Navigation forbidden');}});
globalThis.history={replaceState(_state,_title,url){address=new URL(url,address);replacements.push(address.href);}};
class Node {
  constructor(tag='div'){this.tag=tag;this.id='';this.children=[];this.dataset={};this.style={};this.handlers={};this.attributes={};this.hidden=false;this.disabled=false;this.textContent='';this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,on)=>{on??=!this.classes.has(x);on?this.classes.add(x):this.classes.delete(x);return on;}};}
  get tagName(){return this.tag.toUpperCase();}
  get isContentEditable(){return this.attributes.contenteditable==='true'||this.parent?.isContentEditable===true;}
  closest(selector){for(let node=this;node;node=node.parent)if(selector.split(',').some(part=>matches(node,part.trim())))return node;return null;}
  get className(){return [...this.classes].join(' ');} set className(value){this.classes=new Set(String(value).split(/\\s+/).filter(Boolean));}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  all(){return this.children.flatMap(node=>[node,...node.all()]);}
  querySelectorAll(selector){return this.all().filter(node=>selector.split(',').some(part=>matches(node,part.trim())));}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  addEventListener(name,handler){(this.handlers[name]??=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getBoundingClientRect(){return {top:94,bottom:148,height:54,left:28,right:477,width:449};}
  cloneNode(deep){const node=new Node(this.tag);Object.assign(node,{id:this.id,className:this.className,dataset:{...this.dataset},hidden:this.hidden,textContent:this.textContent});if(deep)node.append(...this.children.map(child=>child.cloneNode(true)));return node;}
}
function matches(node,selector){
  const parts=selector.split(/\\s+/);if(parts.length>1){if(!matches(node,parts.pop()))return false;for(let p=node.parent;p;p=p.parent)if(matches(p,parts.join(' ')))return true;return false;}
  if(selector.includes(':not([hidden])')){if(node.hidden)return false;selector=selector.replace(':not([hidden])','');}
  const a=selector.match(/\\[([^=\\]]+)(?:="([^"]*)")?\\]/);if(a){const key=a[1].replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());const value=a[1].startsWith('data-')?node.dataset[key]:a[1]==='id'?node.id||undefined:node.attributes[a[1]];if(value===undefined||(a[2]!==undefined&&value!==a[2]))return false;selector=selector.replace(a[0],'');}
  return !selector||selector.startsWith('#')?(!selector||node.id===selector.slice(1)):selector.startsWith('.')?node.classes.has(selector.slice(1)):node.tag===selector;
}
const body=new Node('body'),head=new Node('head');
globalThis.document={body,head,activeElement:body,title:'',createElement:tag=>new Node(tag),addEventListener(){},getElementById:id=>body.all().find(node=>node.id===id)??null,querySelectorAll:s=>body.querySelectorAll(s),querySelector:s=>body.querySelector(s)};
const add=(parent,tag,id='',classes='')=>{const node=new Node(tag);node.id=id;node.className=classes;parent.append(node);return node;};
const title=add(body,'header','','title');add(title,'p','','eyebrow');add(title,'h1','title');add(title,'p','sub');add(title,'div','repos');
for(const [id,cls]of[['scene',''],['stats',''],['caption','caption'],['strip',''],['bar','bar'],['labels2',''],['legend',''],['tip',''],['qr-panel','']])add(body,'div',id,cls);
const side=add(body,'aside','side'),tools=add(side,'div','tools'),wrap=add(tools,'span','','tool-wrap'),show=add(wrap,'button','','tool');show.dataset.pop='pop-show';add(show,'b','t-show');
add(side,'button','toolbar-visibility');
const panel=add(wrap,'div','pop-show','pop');panel.hidden=true;const layouts=add(panel,'div','layouts');
const html=readFileSync(new URL('./index.html',startUrl),'utf8'),menu=html.match(/id="layouts">([\\s\\S]*?)<\\/div>/)?.[1];
if(!menu)throw Error('Show menu absent');for(const match of menu.matchAll(/<button data-layout="([^"]+)">([^<]+)<\\/button>/g)){const button=add(layouts,'button');button.dataset.layout=match[1];button.textContent=match[2];}
for(const id of ['layout-note','selection-label','graph-controls'])add(panel,'div',id);
add(tools,'button','story');add(tools,'button','legacy-camera-tool');
for(const id of ['coarse-view','less-detail','more-detail','recenter-view'])add(tools,'button',id);
add(tools,'select','process-focus');add(tools,'div','process-detail-status');
const details=add(side,'aside','details','details');details.hidden=true;add(details,'button','details-close');add(details,'div','details-body');
const reader=add(body,'aside','reader','reader');reader.hidden=true;add(reader,'button','reader-close');add(reader,'div','reader-body');
globalThis.console={error(error){errors.push(error.message);}};
function surface(kind,data,message,options={}){
  actions.push({kind:'mount',surface:kind,data,exactSnapshot:data===input.data,message,host:options.host?.id,tools:options.tools?.id,detail:options.detail?.id,reader:options.reader?.id});
  retained[kind]=kind==='temporal'?input.temporalState??{time:{mode:'story',at:2022.25}}:{};
  return controllers[kind]={activate(view,state){active.add(kind);if(active.size!==1)throw Error('Multiple active surfaces');actions.push({kind:'activate',surface:kind,view,state});},deactivate(){active.delete(kind);actions.push({kind:'deactivate',surface:kind});},getState(){return structuredClone(retained[kind]);},destroy(){actions.push({kind:'destroy',surface:kind});},select(record){options.onSelect?.(record);},setDetail(level){actions.push({kind:'detail',surface:kind,level});},recenter(){actions.push({kind:'recenter',surface:kind});}};
}
globalThis.__route={input,actions,surface};
const sources={
  './common.js':'export async function loadData(params){const r=globalThis.__route;r.actions.push({kind:"load",query:params.toString()});if(r.input.loadError)throw Error("snapshot absent");return {name:"fixture",data:r.input.data};}',
  './inspector.js':'export function showInspector(data,message,options){return globalThis.__route.surface("structure",data,message,options);}',
  './model-picker.js':'export async function mountModelPicker(){globalThis.__route.actions.push({kind:"picker"});}',
  './graph-view.js':'export function showGraph(data,options){if(globalThis.__route.input.graphError)throw Error("WebGL absent");return globalThis.__route.surface("graph",data,null,options);}',
  './view.js':'if(globalThis.__route.input.trajectoryError)throw Error("trajectory unavailable");export const temporalController=globalThis.__route.surface("temporal",globalThis.__route.input.data);'
};
registerHooks({resolve(specifier,context,next){if(context.parentURL===startUrl&&Object.hasOwn(sources,specifier)){imports.push(specifier);return {url:'viewer-routing:'+specifier,shortCircuit:true};}return next(specifier,context);},load(url,context,next){if(url.startsWith('viewer-routing:'))return {format:'module',source:sources[url.slice('viewer-routing:'.length)],shortCircuit:true};return next(url,context);}});
await import(startUrl);
for(const action of input.steps??[]){
  if(action.state)retained[action.surface]=action.state;
  if(Object.hasOwn(action,'selection'))window.modelViewer.selectRecord(action.selection);
  if(action.surfaceSelection)controllers[action.surface].select(action.surfaceSelection);
  if(action.recenter){const button=document.getElementById('recenter-view');for(const handler of button.handlers.click??[])await handler({target:button});}
  if(action.toggleToolbar){const button=document.getElementById('toolbar-visibility');for(const handler of button.handlers.click??[])await handler({target:button});toolbarStates.push({hidden:tools.hidden,label:button.textContent,expanded:button.attributes['aria-expanded'],restoreHidden:button.hidden,state:window.modelViewer.getState()});}
  if(action.key){
    for(const id of ['reader','graph-reader']){const reader=document.getElementById(id);if(reader)reader.hidden=action.openReader!==id;}
    const target=action.targetTag?new Node(action.targetTag):body;if(action.editable){target.setAttribute('contenteditable','true');}
    if(action.editableParent){const parent=new Node('div');parent.setAttribute('contenteditable','true');parent.append(target);}
    document.activeElement=target;const event={key:action.key,target,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,defaultPrevented:false,...action.modifiers,preventDefault(){this.defaultPrevented=true;}};
    for(const handler of handlers.keydown??[])await handler(event);keys.push({key:event.key,prevented:event.defaultPrevented});
  }
  if(action.coarse){const button=document.getElementById('coarse-view');for(const handler of button.handlers.click??[])await handler({target:button});}
  if(action.view){if(action.button){const button=layouts.children.find(node=>node.dataset.layout===action.view);for(const handler of button.handlers.click??[])await handler({target:button});}else await window.modelViewer.switchView(action.view);}
  if(action.pagehide){for(const handler of handlers.pagehide??[])handler(action.pagehide);await Promise.resolve();}
}
process.stdout.write(JSON.stringify({actions,imports,errors,replacements,keys,toolbarStates,url:location.href,state:window.modelViewer.getState(),representation:body.dataset.representation,buttons:layouts.children.map(node=>({view:node.dataset.layout,label:node.textContent,disabled:node.disabled,pressed:node.attributes['aria-pressed']})),surfaces:body.all().filter(node=>['graph-surface','structure-surface'].includes(node.id)).map(node=>node.id),sharedToolbarRetained:document.getElementById('t-show')===show.children[0],recenterHidden:document.getElementById('recenter-view').hidden,recenterTemporalOnly:Object.hasOwn(document.getElementById('recenter-view').dataset,'temporal'),coarseDisabled:document.getElementById('coarse-view').disabled,coarseTemporalOnly:Object.hasOwn(document.getElementById('coarse-view').dataset,'temporal')}));
`;

function run({ view, data, query = {}, ...options }) {
  const url = new URL('http://127.0.0.1:1234/token/?reading=off&flat=hide&unopened=hide&at=2022.25#old-location');
  if (view !== undefined) url.searchParams.set('view', view);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', harness,
    new URL('../viewer/public/start.js', import.meta.url).href], {
    input: JSON.stringify({ url: url.href, data, ...options }), encoding: 'utf8', timeout: 5_000,
  }));
}
const snapshot = (trajectories = false) => ({ title: 'Exact snapshot', viewKind: 'graph', modelHash: 'exact-model',
  capabilities: { graph: true, trajectories, story: false, construction: false },
  inspection: { model: { id: 'native-model', time_unit: 'machine_cycle', processes: [] } } });
const activations = (result) => result.actions.filter((action) => action.kind === 'activate');
const mounts = (result) => result.actions.filter((action) => action.kind === 'mount');

test('startup selects Processes with paths, Tree with dated Events, and Graph without time', () => {
  const dated = snapshot(); dated.capabilities.temporal = true;
  for (const [data, expected] of [[snapshot(true), 'together'], [dated, 'layers'], [snapshot(), 'graph']]) {
    for (const view of [undefined, 'unknown-view']) {
      const result = run({ view, data });
      assert.equal(activations(result)[0].view, expected); assert.equal(mounts(result).length, 1);
      assert.equal(mounts(result)[0].exactSnapshot, true); assert.deepEqual(result.errors, []);
    }
  }
});

test('all five Show choices stay on one page and reuse renderers with the exact loaded snapshot', () => {
  const result = run({ view: 'layers', data: snapshot(true), steps: [
    { view: 'graph', button: true }, { view: 'structure', button: true }, { view: 'together', button: true },
    { view: 'terrain', button: true }, { view: 'layers', button: true }, { view: 'graph' }, { view: 'structure' },
  ] });
  assert.deepEqual(result.buttons.map(({ view, label }) => ({ view, label })), [
    { view: 'together', label: 'Processes' }, { view: 'layers', label: 'Tree' }, { view: 'terrain', label: 'Terrain' },
    { view: 'graph', label: 'Graph' }, { view: 'structure', label: 'Structure' },
  ]);
  assert.deepEqual(activations(result).map(({ view }) => view), ['layers', 'graph', 'structure', 'together', 'terrain', 'layers', 'graph', 'structure']);
  assert.deepEqual(mounts(result).map(({ surface }) => surface).sort(), ['graph', 'structure', 'temporal']);
  assert.ok(mounts(result).every((mount) => mount.exactSnapshot));
  for (const kind of ['load', 'picker']) assert.equal(result.actions.filter((action) => action.kind === kind).length, 1);
  for (const name of ['./view.js', './graph-view.js']) assert.equal(result.imports.filter((item) => item === name).length, 1);
  assert.deepEqual(result.errors, []); assert.equal(result.sharedToolbarRetained, true); assert.equal(result.representation, 'structure');
  for (const address of result.replacements) {
    const url = new URL(address); assert.equal(url.pathname, '/token/');
    for (const [key, value] of [['reading', 'off'], ['flat', 'hide'], ['unopened', 'hide'], ['at', '2022.25']]) assert.equal(url.searchParams.get(key), value);
  }
  const graph = mounts(result).find((mount) => mount.surface === 'graph');
  assert.deepEqual([graph.host, graph.tools, graph.detail, graph.reader], ['graph-scene', 'graph-controls', 'graph-details', 'graph-reader']);
  assert.deepEqual(result.surfaces.sort(), ['graph-surface', 'structure-surface']);
});

test('native selection and time transfer through Graph and Structure and explicit selection clearing', () => {
  const record = { kind: 'normalized_cut', id: 'cut:exact' }, time = { mode: 'construction', at: '2026-09-27T12:00:00.000Z', t0: 1, t1: 9 };
  const result = run({ view: 'layers', data: snapshot(true), query: { record: JSON.stringify({ kind: 'event', id: 'initial' }) }, steps: [
    { surface: 'temporal', state: { time } }, { selection: record }, { view: 'graph' },
    { surface: 'graph', surfaceSelection: { kind: 'process', id: 'chosen-in-graph' } },
    { view: 'structure' }, { view: 'terrain' }, { selection: null }, { view: 'graph' },
  ] });
  const shown = activations(result);
  assert.deepEqual(shown[0].state.selection, { kind: 'event', id: 'initial' });
  assert.deepEqual(shown[1].state.selection, record); assert.deepEqual(shown[1].state.time, time);
  for (const item of shown.slice(2, 4)) {
    assert.deepEqual(item.state.selection, { kind: 'process', id: 'chosen-in-graph' }); assert.deepEqual(item.state.time, time);
  }
  assert.equal(shown.at(-1).state.selection, null); assert.equal(new URL(result.url).searchParams.has('record'), false);
  assert.equal(new URL(result.url).searchParams.get('timeView'), 'terrain');
});

test('Structure loads without either renderer and disables only unavailable time views', () => {
  for (const available of [false, true]) {
    const result = run({ view: 'structure', data: snapshot(available) });
    assert.deepEqual(activations(result).map(({ view }) => view), ['structure']);
    assert.ok(!result.imports.includes('./view.js') && !result.imports.includes('./graph-view.js'));
    assert.ok(result.buttons.filter(({ view }) => ['together', 'layers', 'terrain'].includes(view)).every((button) => button.disabled === !available));
    assert.ok(result.buttons.filter(({ view }) => ['graph', 'structure'].includes(view)).every((button) => !button.disabled));
  }
});

test('explicit temporal routes honor capability false and support older timeline snapshots', () => {
  for (const view of ['together', 'layers', 'terrain']) {
    const unavailable = snapshot(); unavailable.viewKind = 'timeline';
    const result = run({ view, data: unavailable });
    assert.equal(activations(result)[0].view, 'graph'); assert.ok(!result.imports.includes('./view.js'));
    const legacy = snapshot(); legacy.viewKind = 'timeline'; delete legacy.capabilities;
    assert.equal(activations(run({ view, data: legacy }))[0].view, view);
  }
});

test('renderer failure falls back to embedded Structure and load failure invents no snapshot', () => {
  const data = snapshot(true);
  for (const options of [{ view: 'graph', graphError: true }, { view: 'together', trajectoryError: true }]) {
    const result = run({ data, ...options }), shown = mounts(result).find((mount) => mount.surface === 'structure');
    assert.deepEqual(shown.data, data); assert.match(shown.message, /3D view is unavailable/);
    assert.equal(shown.host, 'structure-surface'); assert.equal(result.errors.length, 1); assert.equal(activations(result).at(-1).view, 'structure');
  }
  const failed = run({ data, loadError: true }), shown = mounts(failed)[0];
  assert.equal(shown.surface, 'structure'); assert.equal(shown.data, null); assert.match(shown.message, /snapshot absent/);
  assert.ok(!failed.imports.includes('./view.js') && !failed.imports.includes('./graph-view.js'));
});

test('page exit cleans up retained surfaces while a persisted page keeps them', () => {
  const persisted = run({ data: snapshot(true), steps: [{ view: 'graph' }, { pagehide: { persisted: true } }] });
  assert.equal(persisted.actions.filter((action) => action.kind === 'destroy').length, 0);
  const exited = run({ data: snapshot(true), steps: [{ view: 'graph' }, { view: 'structure' }, { pagehide: { persisted: false } }] });
  assert.deepEqual(exited.actions.filter((action) => action.kind === 'destroy').map(({ surface }) => surface).sort(), ['graph', 'structure', 'temporal']);
});

test('Coarse is reachable from every representation on the same page and retains the active selection and time', () => {
  for (const view of ['together', 'layers', 'terrain', 'graph', 'structure']) {
    const selection = { kind: 'event', id: 'engine' };
    const result = run({ view, data: snapshot(true), query: { record: JSON.stringify(selection), scope: 'engine', detail: '3' }, steps: [{ coarse: true }] });
    assert.equal(result.coarseDisabled, false); assert.equal(result.coarseTemporalOnly, false);
    assert.equal(activations(result).at(-1).view, 'layers');
    assert.deepEqual(result.state.selection, selection);
    assert.deepEqual(result.actions.filter((action) => action.kind === 'detail'), [{ kind: 'detail', surface: 'temporal', level: 0 }]);
    assert.equal(mounts(result).filter((mount) => mount.surface === 'temporal').length, 1);
    assert.equal(new URL(result.url).searchParams.get('at'), '2022.25');
    assert.equal(new URL(result.url).searchParams.get('scope'), 'engine');
    assert.deepEqual(result.errors, []);
  }
  assert.equal(run({ view: 'graph', data: snapshot() }).coarseDisabled, true);
});


test('Recenter button and Home each frame only the active view without navigation, mounting or clearing context', () => {
  const selection = { kind: 'event', id: 'engine' };
  for (const view of ['together', 'layers', 'terrain', 'graph']) {
    for (const step of [{ recenter: true }, { key: 'Home' }]) {
      const result = run({ view, data: snapshot(true), query: { record: JSON.stringify(selection), scope: 'engine', detail: '2', run: 'writer-latest' }, steps: [step] });
      assert.deepEqual(result.actions.filter(action => action.kind === 'recenter'), [{ kind: 'recenter', surface: view === 'graph' ? 'graph' : 'temporal' }]);
      assert.equal(result.recenterHidden, false); assert.equal(result.recenterTemporalOnly, false);
      assert.equal(mounts(result).length, 1); assert.equal(activations(result).length, 1);
      assert.deepEqual(result.state.selection, selection); assert.equal(result.state.view, view);
      const url = new URL(result.url);
      for (const [key, value] of [['scope', 'engine'], ['detail', '2'], ['run', 'writer-latest'], ['flat', 'hide'], ['unopened', 'hide'], ['at', '2022.25']]) assert.equal(url.searchParams.get(key), value);
      if (step.key) assert.deepEqual(result.keys, [{ key: 'Home', prevented: true }]);
      assert.deepEqual(result.errors, []);
    }
  }
});

test('Home keeps native text navigation, modifier shortcuts and readers intact', () => {
  const ignored = [
    ...['input', 'textarea', 'select'].map(targetTag => ({ targetTag })),
    { targetTag: 'div', editable: true }, { targetTag: 'span', editableParent: true },
    ...['ctrlKey', 'metaKey', 'altKey', 'shiftKey'].map(key => ({ modifiers: { [key]: true } })),
    { modifiers: { defaultPrevented: true } }, { modifiers: { repeat: true } },
  ];
  for (const view of ['layers', 'graph']) {
    for (const options of [...ignored, { openReader: view === 'graph' ? 'graph-reader' : 'reader' }]) {
      const result = run({ view, data: snapshot(true), steps: [{ key: 'Home', ...options }] });
      assert.deepEqual(result.actions.filter(action => action.kind === 'recenter'), [], `${view}: ${JSON.stringify(options)}`);
      assert.deepEqual(result.keys, [{ key: 'Home', prevented: options.modifiers?.defaultPrevented ?? false }]);
      assert.equal(result.state.view, view);
    }
  }
  const structure = run({ view: 'structure', data: snapshot(true), steps: [{ key: 'Home' }] });
  assert.equal(structure.recenterHidden, true);
  assert.deepEqual(structure.actions.filter(action => action.kind === 'recenter'), []);
  assert.deepEqual(structure.keys, [{ key: 'Home', prevented: false }]);
  assert.deepEqual(mounts(structure).map(action => action.surface), ['structure']);
});

test('Recenter follows switches instead of resetting retained hidden surfaces', () => {
  const result = run({ view: 'layers', data: snapshot(true), steps: [
    { key: 'Home' }, { view: 'graph' }, { key: 'Home' }, { view: 'structure' }, { key: 'Home' },
    { view: 'terrain' }, { recenter: true },
  ] });
  assert.deepEqual(result.actions.filter(action => action.kind === 'recenter').map(action => action.surface), ['temporal', 'graph', 'temporal']);
  assert.deepEqual(mounts(result).map(action => action.surface), ['temporal', 'graph', 'structure']);
  assert.deepEqual(result.errors, []);
});

test('the top toolbar can be hidden and restored in every representation without losing model state', () => {
  const selection = { kind: 'event', id: 'some-event' };
  for (const view of ['layers', 'together', 'terrain', 'graph', 'structure']) {
    const result = run({ view, data: snapshot(true), steps: [
      { selection }, { toggleToolbar: true }, { toggleToolbar: true },
    ] });
    assert.equal(result.toolbarStates.length, 2);
    for (const [i, entry] of result.toolbarStates.entries()) {
      assert.equal(entry.hidden, i === 0);
      assert.equal(entry.label, i === 0 ? 'Show controls' : 'Hide controls');
      assert.equal(entry.expanded, String(i !== 0));
      assert.equal(entry.restoreHidden, false);
      assert.equal(entry.state.view, view);
      assert.deepEqual(entry.state.selection, selection);
    }
    assert.deepEqual(result.toolbarStates[0].state, result.toolbarStates[1].state);
    assert.equal(result.actions.filter(action => action.kind === 'event' && action.type === 'viewer-controls-change').length, 2);
    assert.deepEqual(result.actions.filter(action => action.kind === 'recenter'), []);
    assert.equal(mounts(result).length, 1);
    assert.deepEqual(result.errors, []);
  }
});
