import type { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Own-window fixture only: never capture the desktop or a real conversation. */
export async function checkPanelLayout(
  chat: BrowserWindow,
  settings: BrowserWindow,
  artifacts: string,
): Promise<Record<string, unknown>> {
  const bounds = chat.getBounds();
  const settingsBounds = settings.getBounds();
  const zoom = chat.webContents.getZoomFactor();
  const settingsZoom = settings.webContents.getZoomFactor();
  const checks: Array<Record<string, unknown>> = [];
  await chat.webContents.executeJavaScript(`(()=>{
    const conversation=document.getElementById('conversation'),input=document.getElementById('message');
    window.__layoutRestore={nodes:[...conversation.childNodes],draft:input.value,scroll:conversation.scrollTop};
    conversation.replaceChildren();
    const add=(role,text)=>{
      const row=document.createElement('article');row.className='message '+role;
      const label=document.createElement('p');label.className='message-label';label.textContent=role==='user'?'YOU':'COMPANION';
      const content=document.createElement('div');content.className='message-text';
      const p=document.createElement('p');p.textContent=text;content.append(p);row.append(label,content);conversation.append(row);return content;
    };
    add('user','둘 다!');add('assistant','작은 동작도 또렷하게 보이도록 고개 반응을 조절했어.');
    const markdown=add('assistant','긴 코드와 표는 메시지 안에서만 스크롤해.');
    const pre=document.createElement('pre');pre.textContent='const result = '+ 'sample_value_'.repeat(40);markdown.append(pre);
    const table=document.createElement('table'),tr=document.createElement('tr');
    for(let i=0;i<8;i++){const td=document.createElement('td');td.textContent='컬럼 '+i;tr.append(td);}table.append(tr);markdown.append(table);
    for(let i=0;i<10;i++)add(i%2?'assistant':'user','한국어와 English가 함께 있는 대화의 줄바꿈과 간격을 확인해. '+i);
  })()`);
  try {
    for (const [width, height, factor] of [
      [470, 810, 1],
      [400, 600, 1],
      [640, 900, 1],
      [400, 600, 1.25],
    ]) {
      chat.setSize(width!, height!);
      chat.webContents.setZoomFactor(factor!);
      settings.setSize(width!, height!);
      settings.webContents.setZoomFactor(factor!);
      await chat.webContents.executeJavaScript(
        'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
      );
      const conversation = await chat.webContents.executeJavaScript(`(()=>{
        const input=document.getElementById('message'),conversation=document.getElementById('conversation');
        const row=conversation.querySelector('.message.user .message-text');
        const compact=row.getBoundingClientRect().width<innerWidth/2;
        input.value='첫 번째 줄';input.dispatchEvent(new Event('input',{bubbles:true}));const short=input.getBoundingClientRect().height;
        const bounds=id=>document.getElementById(id).getBoundingClientRect(),middle=r=>r.top+r.height/2;
        const attach=bounds('attach'),sendShort=bounds('send'),textShort=bounds('message');
        const icons=[...document.querySelectorAll('#composer button svg')].map(node=>node.getBoundingClientRect());
        const aligned=attach.width===32&&attach.height===32&&sendShort.width===32&&sendShort.height===32&&textShort.height===32&&Math.abs(middle(attach)-middle(sendShort))<0.6&&Math.abs(middle(textShort)-middle(sendShort))<0.6&&icons.length===2&&icons.every(r=>r.width===18&&r.height===18)&&Math.abs(middle(icons[0])-middle(icons[1]))<0.6;
        const stop=document.getElementById('stop'),status=document.getElementById('turn-status'),wasHidden=stop.hidden;
        stop.hidden=false;const footerAligned=Math.abs(middle(stop.getBoundingClientRect())-middle(status.getBoundingClientRect()))<0.6;stop.hidden=wasHidden;const hiddenActions=!wasHidden||stop.getBoundingClientRect().height===0;

        input.value=Array(14).fill('여러 줄의 입력을 확인해.').join('\\n');input.dispatchEvent(new Event('input',{bubbles:true}));const tall=input.getBoundingClientRect().height;
        const send=document.getElementById('send').getBoundingClientRect(),footer=document.querySelector('#chat footer').getBoundingClientRect();
        const fit=document.documentElement.scrollWidth<=innerWidth&&footer.bottom<=innerHeight+1&&send.bottom<=innerHeight&&send.right<=innerWidth&&conversation.clientHeight>100;
        const styles=getComputedStyle(document.getElementById('chat'));
        return {noHeader:!document.querySelector('#chat header'),compact,aligned,footerAligned,hiddenActions,multilineAligned:Math.abs(send.bottom-input.getBoundingClientRect().bottom)<0.6,fit,autoGrow:tall>short&&tall<=120,scrollable:conversation.scrollHeight>conversation.clientHeight,
          font:styles.fontFamily.startsWith('"Ubuntu Mono"'),background:styles.backgroundColor==='rgba(30, 25, 31, 0.8)'};
      })()`);
      const settingsFit = await settings.webContents.executeJavaScript(`(()=>{
        const panel=document.getElementById('settings');const style=getComputedStyle(panel);
        const row=document.querySelector('#settings .button-row'),buttons=[...row.querySelectorAll('button')].map(b=>b.getBoundingClientRect());
        const aligned=buttons.every(b=>b.height===32)&&Math.abs(buttons[0].top-buttons[1].top)<0.6;
        return aligned&&document.documentElement.scrollWidth<=innerWidth&&panel.scrollHeight>panel.clientHeight&&style.backgroundColor==='rgba(30, 25, 31, 0.8)'&&style.fontFamily.startsWith('"Ubuntu Mono"');
      })()`);
      checks.push({ width, height, zoom: factor, ...conversation, settingsFit });
      if (width === 470) {
        await chat.webContents.executeJavaScript(
          "(()=>{const input=document.getElementById('message'),status=document.getElementById('turn-status'),stop=document.getElementById('stop');window.__layoutMeta={text:status.textContent,hidden:stop.hidden};input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();status.textContent='응답 수신 중';stop.hidden=false;})()",
        );
        await chat.webContents.executeJavaScript(
          "document.getElementById('conversation').scrollTop=0;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
        );
        const screenshot = await chat.webContents.capturePage();
        await writeFile(join(artifacts, 'compact-chat-smoke.png'), screenshot.toPNG());
        await writeFile(
          join(artifacts, 'compact-settings-smoke.png'),
          (await settings.webContents.capturePage()).toPNG(),
        );
        await chat.webContents.executeJavaScript(
          "document.getElementById('turn-status').textContent=window.__layoutMeta.text;document.getElementById('stop').hidden=window.__layoutMeta.hidden;delete window.__layoutMeta",
        );
      }
    }
    return {
      passed: checks.every((row) =>
        Object.entries(row).every(
          ([key, value]) => ['width', 'height', 'zoom'].includes(key) || value === true,
        ),
      ),
      checks,
    };
  } finally {
    chat.setBounds(bounds);
    chat.webContents.setZoomFactor(zoom);
    settings.setBounds(settingsBounds);
    settings.webContents.setZoomFactor(settingsZoom);
    await chat.webContents.executeJavaScript(`(()=>{
      const saved=window.__layoutRestore,conversation=document.getElementById('conversation'),input=document.getElementById('message');
      conversation.replaceChildren(...saved.nodes);input.value=saved.draft;input.dispatchEvent(new Event('input',{bubbles:true}));conversation.scrollTop=saved.scroll;
      delete window.__layoutRestore;
    })()`);
  }
}
