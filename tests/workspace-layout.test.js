import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {bindWorkspaceLayout} from '../dist/workspace-layout.js';
test('panels fully collapse, preserve widths and restore without a workspace toolbar',()=>{
 const w=new Window();globalThis.window=w;globalThis.document=w.document;globalThis.localStorage=w.localStorage;globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 document.body.innerHTML='<div class="app-layout"><aside id="library-panel"></aside><main><section></section></main><aside id="inspector-panel"></aside></div>';
 const root=document.querySelector('.app-layout'),panel=document.querySelector('section');Object.defineProperty(root,'clientWidth',{value:1440});
 bindWorkspaceLayout({root,panel});assert.equal(document.querySelector('.workspace-layout-tools'),null);
 const toggle=(name,open)=>root.dispatchEvent(new w.CustomEvent('set-panel-open',{detail:{name,open}}));
 toggle('inventory',false);toggle('inspector',false);assert.equal(root.style.getPropertyValue('--inventory-width'),'0px');assert.equal(root.style.getPropertyValue('--inspector-width'),'0px');
 const saved=JSON.parse(localStorage.getItem('optibench-workspace-layouts'));assert.deepEqual(saved.collapsed,{inventory:true,inspector:true});assert.equal(saved.current.inventory,286);
 toggle('inventory',true);toggle('inspector',true);assert.equal(root.style.getPropertyValue('--inventory-width'),'286px');assert.equal(root.style.getPropertyValue('--inspector-width'),'294px');
 document.querySelector('.inventory-splitter').onkeydown(new w.KeyboardEvent('keydown',{key:'ArrowRight'}));toggle('inventory',false);toggle('inventory',true);assert.equal(root.style.getPropertyValue('--inventory-width'),'296px');
});
