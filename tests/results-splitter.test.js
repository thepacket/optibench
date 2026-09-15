import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { bindResultsSplitter } from '../dist/results-splitter.js';
test('splitter keyboard resizing is bounded, persists, expands and resets', () => {
 const w=new Window();globalThis.window=w;globalThis.localStorage=w.localStorage;
 globalThis.ResizeObserver=class {observe(){} disconnect(){}};
 w.document.body.innerHTML='<main><header></header><div class="bench-stage"></div><div id="handle"></div><section></section></main>';
 const workspace=w.document.querySelector('main'),panel=w.document.querySelector('section'),handle=w.document.querySelector('#handle');
 Object.defineProperty(workspace,'clientHeight',{value:700});workspace.querySelector('header').getBoundingClientRect=()=>({height:100});handle.getBoundingClientRect=()=>({height:12});panel.getBoundingClientRect=()=>({height:261});
 let expanded=0;bindResultsSplitter({workspace,panel,handle,expand:()=>expanded++});
 const key=k=>handle.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true}));
 key('End');assert.equal(handle.getAttribute('aria-valuenow'),'408');assert.equal(localStorage.getItem('optibench-results-height'),'408');key('ArrowUp');assert.equal(handle.getAttribute('aria-valuenow'),'408');key('Home');assert.equal(handle.getAttribute('aria-valuenow'),'130');key('ArrowDown');assert.equal(handle.getAttribute('aria-valuenow'),'130');handle.dispatchEvent(new w.MouseEvent('dblclick'));assert.equal(panel.style.getPropertyValue('--results-height'),'261px');assert.equal(expanded,5);
});
