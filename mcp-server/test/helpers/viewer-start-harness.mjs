// Execute the real start module and session coordinator with only the browser
// and renderer mounts replaced. Navigation throws; only history writes work.
export const harness = `
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
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
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
add(tools,'div','space-controls');
add(tools,'button','story');add(tools,'button','legacy-camera-tool');
for(const id of ['coarse-view','less-detail','more-detail','recenter-view'])add(tools,'button',id);
add(tools,'select','process-focus');add(tools,'div','process-detail-status');
const details=add(side,'aside','details','details');details.hidden=true;add(details,'button','details-close');add(details,'div','details-body');
const reader=add(body,'aside','reader','reader');reader.hidden=true;add(reader,'button','reader-close');add(reader,'div','reader-body');
globalThis.console={error(error){errors.push(error.message);}};
function surface(kind,data,message,options={}){
  actions.push({kind:'mount',surface:kind,data,exactSnapshot:data===input.data,message,host:options.host?.id,tools:options.tools?.id,detail:options.detail?.id,reader:options.reader?.id,readerData:options.reader?.dataset});
  retained[kind]=input.surfaceState?.[kind]??(kind==='temporal'?input.temporalState??{time:{mode:'story',at:2022.25}}:{});
  return controllers[kind]={activate(view,state){active.add(kind);if(active.size!==1)throw Error('Multiple active surfaces');actions.push({kind:'activate',surface:kind,view,state});},showHighlight(target){actions.push({kind:'highlight',surface:kind,target});},deactivate(){active.delete(kind);actions.push({kind:'deactivate',surface:kind});},getState(){return structuredClone(retained[kind]);},destroy(){actions.push({kind:'destroy',surface:kind});},select(record){options.onSelect?.(record);},setDetail(level){actions.push({kind:'detail',surface:kind,level});},coarse(){actions.push({kind:'coarse',surface:kind});},recenter(){actions.push({kind:'recenter',surface:kind});}};
}
globalThis.__route={input,actions,surface};
const sources={
  './common.js':'export async function loadData(params){const r=globalThis.__route;r.actions.push({kind:"load",query:params.toString()});if(r.input.loadError)throw Error("snapshot absent");return {name:"fixture",data:r.input.data};}',
  './inspector.js':'export function showInspector(data,message,options){return globalThis.__route.surface("structure",data,message,options);}',
  './model-picker.js':'export async function mountModelPicker(){globalThis.__route.actions.push({kind:"picker"});}',
  './graph-view.js':'export function showGraph(data,options){if(globalThis.__route.input.graphError)throw Error("WebGL absent");return globalThis.__route.surface("graph",data,null,options);}',
  './space-view.js':'export function showSpace(data,options){return globalThis.__route.surface("space",data,null,options);}',
  './view.js':'if(globalThis.__route.input.trajectoryError)throw Error("trajectory unavailable");export const temporalController=globalThis.__route.surface("temporal",globalThis.__route.input.data);'
};
if(input.chosenViewHarness)Object.assign(sources,{
  './live-viewer.js':'export const takeLiveContext=()=>globalThis.__route.input.liveContext??null; export const mountLiveViewer=()=>()=>{};',
  './chosen-view.js':'export const noteAddress=()=>{}; export const mountChosenView=({opening,onHighlight})=>{globalThis.__route.opening=opening;globalThis.__route.highlight=onHighlight;};',
});
registerHooks({resolve(specifier,context,next){if(context.parentURL===startUrl&&Object.hasOwn(sources,specifier)){imports.push(specifier);return {url:'viewer-routing:'+specifier,shortCircuit:true};}return next(specifier,context);},load(url,context,next){if(url.startsWith('viewer-routing:'))return {format:'module',source:sources[url.slice('viewer-routing:'.length)],shortCircuit:true};return next(url,context);}});
await import(startUrl);
for(const target of input.highlights??[])await globalThis.__route.highlight(target);
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
process.stdout.write(JSON.stringify({opening:globalThis.__route.opening,actions,imports,errors,replacements,keys,toolbarStates,url:location.href,state:window.modelViewer.getState(),representation:body.dataset.representation,buttons:layouts.children.map(node=>({view:node.dataset.layout,label:node.textContent,disabled:node.disabled,pressed:node.attributes['aria-pressed']})),surfaces:body.all().filter(node=>['graph-surface','structure-surface','space-surface'].includes(node.id)).map(node=>node.id),sharedToolbarRetained:document.getElementById('t-show')===show.children[0],recenterHidden:document.getElementById('recenter-view').hidden,recenterTemporalOnly:Object.hasOwn(document.getElementById('recenter-view').dataset,'temporal'),coarseDisabled:document.getElementById('coarse-view').disabled,coarseTemporalOnly:Object.hasOwn(document.getElementById('coarse-view').dataset,'temporal')}));
`;
