(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = ['Lá', 'Dó', 'Ré', 'Mi', 'Sol', 'Lá↑'];
  const colors = ['#ef926e','#f4b67e','#e6cc86','#b9c4a4','#a9bcca','#b8a8c9'];
  const example = {call:[0,1,4,5,2,1,3,4],reply:[0,3,5,4,1,2,4,1]};
  const state = {call:[], reply:[], role:'call', angle:38, durations:{call:[],reply:[]}};
  let playing = false, playToken = 0, step = null;
  let incoming = false, invalid = false, downloadBusy = false;

  function decode() {
    const match = /^#d1\.([0-5]{1,8})\.([0-5]{0,8})\.(0|[1-9][0-9]?)(?:\.([0-9a-z]{1,2})\.([0-9a-z]{1,2}))?$/.exec(location.hash);
    if (!match || Number(match[3]) > 90) return false;
    state.call = Array.from(match[1], Number);
    state.reply = Array.from(match[2], Number);
    state.angle = Number(match[3]);
    for (const [i,role] of ['call','reply'].entries()) {
      const mask = parseInt(match[4+i] || '0',36);
      if(mask >= 2**state[role].length) return false;
      state.durations[role] = state[role].map((_,j)=>(mask & (1<<j)) ? 2 : 1);
    }
    incoming = true;
    state.role = state.reply.length ? 'call' : 'reply';
    return true;
  }
  function urlForShare() {
    const url = new URL(location.href);
    url.search = '';
    const masks = ['call','reply'].map(role=>state.durations[role].reduce((bits,n,i)=>bits | ((n===2?1:0)<<i),0).toString(36));
    url.hash = ['d1', state.call.join(''), state.reply.join(''), state.angle, ...masks].join('.');
    return url.href;
  }
  function replaceAddress() {
    try {
      const url = state.call.length ? urlForShare() : location.href.split('#')[0];
      history.replaceState(null, '', url);
    } catch (_) {}
  }
  function status(message) { $('status').textContent = message; }
  function stop() { playToken++; playing = false; step = null; window.DuetAudio.stop(); }
  function viewState() { return state.call.length ? state : example; }
  function paint() {
    const s = viewState();
    const progress = step ? step.index / Math.max(1, s[step.role].length-1) : -1;
    window.DuetArt.draw($('art'), {call:s.call, reply:s.reply, angle:state.angle, durations:s.durations, progress});
  }
  function setAngle(value) {
    state.angle = Math.max(0, Math.min(90, Math.round(value)));
    $('angle').value = state.angle;
    $('angleText').textContent = state.angle + '°';
    window.DuetAudio.setBlend(state.angle/90);
    paint();
  }
  function updateSlots() {
    const sequence = state[state.role];
    const dots = document.createDocumentFragment();
    for (let i=0;i<8;i++) {
      const li = document.createElement('li');
      if (i<sequence.length) {
        li.style.backgroundColor = colors[sequence[i]];
        const mult = state.durations[state.role][i] || 1;
        li.classList.toggle('long',mult===2);
        const noteButton=document.createElement('button');
        noteButton.type='button';noteButton.textContent=String(sequence[i]+1);
        noteButton.setAttribute('aria-label',names[sequence[i]]+', posição '+(i+1)+', '+(mult===2?'longa. Encurtar':'curta. Alongar'));
        noteButton.setAttribute('aria-pressed',String(mult===2));
        noteButton.title=mult===2?'Encurtar nota':'Alongar nota';
        noteButton.onclick=()=>{stop();state.durations[state.role][i]=mult===2?1:2;replaceAddress();render();$('slots').children[i].firstChild.focus();status(mult===2?'Nota encurtada.':'Nota alongada.');};
        li.append(noteButton);
      } else li.setAttribute('aria-label','Vazia');
      if (step && step.role === state.role && step.index === i) li.classList.add('on');
      dots.append(li);
    }
    $('slots').replaceChildren(dots);
  }
  function render() {
    const hasCall = state.call.length>0, hasReply = state.reply.length>0;
    const seq = state[state.role];
    $('title').innerHTML = incoming && hasCall ? (hasReply ? 'O seu<br><em>dueto.</em>' : 'Uma frase<br><em>para você.</em>') : 'Um dueto<br><em>por carta.</em>';
    $('intro').textContent = incoming && hasCall ? (hasReply ? 'Ouça as duas vozes juntas. Gire a partitura para trazer cada melodia para a frente.' : 'Alguém tocou a primeira voz. Ouça, escolha suas notas e devolva a carta com sua resposta.') : 'Toque uma frase e convide alguém para responder. Juntas, as duas melodias ganham uma forma que você pode girar.';
    $('coverName').textContent = !hasCall ? 'Dueto de exemplo' : hasReply ? 'Sua carta em duas vozes' : 'Sua primeira voz';
    $('composeTitle').textContent = state.role === 'call' ? 'Componha sua frase' : 'Componha a resposta';
    $('seqLabel').textContent = state.role === 'call' ? 'Sua frase' : 'Resposta';
    $('editHint').textContent = seq.length===8 ? 'Oito notas completas. Desfaça a última para trocar.' : 'Use as teclas de 1 a 6 ou toque nos blocos.';
    $('count').textContent = seq.length + ' / 8';
    $('playglyph').textContent = playing ? '■' : '▶';
    $('playlabel').textContent = playing ? 'Parar' : !hasCall ? 'Ouvir exemplo' : hasReply ? 'Ouvir dueto' : 'Ouvir frase';
    $('send').firstChild.textContent = hasReply ? 'Compartilhar dueto ' : 'Convidar alguém ';
    $('send').disabled = !hasCall;
    const preserveReply = state.role==='call' && seq.length===1 && hasReply;
    $('undo').disabled = !seq.length || preserveReply;
    $('undo').title = preserveReply ? 'A resposta precisa de uma nota na primeira voz.' : 'Desfazer última nota';
    $('reset').disabled = !hasCall;
    $('export').disabled = !hasCall || downloadBusy;
    document.querySelectorAll('[data-voice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.voice===state.role));
      button.disabled = button.dataset.voice==='reply' && !hasCall;
    });
    document.querySelectorAll('.pad').forEach(button => { button.disabled = seq.length>=8; });
    $('angle').value = state.angle;
    $('angleText').textContent = state.angle+'°';
    updateSlots();
    paint();
  }
  function add(index) {
    const seq = state[state.role];
    if (seq.length>=8) return;
    stop();
    seq.push(index);
    state.durations[state.role].push(1);
    const preview = window.DuetAudio.preview(index,state.role);
    Promise.resolve(preview).catch(()=>status('O áudio está indisponível. Sua nota foi registrada.'));
    status('');
    const key = $('pads').children[index];
    key.classList.add('hit');
    setTimeout(()=>key.classList.remove('hit'),130);
    replaceAddress();render();
  }
  function showDialog(kind) {
    const share = kind==='share', help=kind==='help';
    $('shareArea').hidden=!share; $('helpArea').hidden=!help; $('confirmReset').hidden=share||help;
    $('dialogTitle').textContent = share ? 'Passe a carta adiante' : help ? 'Como tocar' : 'Começar outra carta?';
    $('dialogBody').textContent = share ? (state.reply.length ? 'O link abre o dueto completo, com as duas vozes e o ângulo da capa.' : 'Quem abrir vai ouvir sua frase e poderá devolver uma nova carta com a resposta.') : help ? 'Escolha até oito notas na primeira voz. Convide outra pessoa para tocar a resposta ou experimente as duas vozes neste aparelho.' : 'Guarde o link se quiser voltar a este dueto.';
    if (share) { const url = new URL(document.querySelector('link[rel=canonical]').href); url.hash = new URL(urlForShare()).hash; $('link').value=url.href; $('copyStatus').textContent=''; }
    $('modal').showModal();
  }
  function download(blob,name) {
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  for(let i=0;i<6;i++) {
    const b=document.createElement('button');b.className='pad';b.type='button';b.dataset.note=i;
    b.style.setProperty('--key',colors[i]);b.setAttribute('aria-label','Tocar '+names[i]+', tecla '+(i+1));
    const title=document.createElement('strong');title.textContent=names[i];
    const number=document.createElement('small');number.textContent='0'+(i+1);b.append(title,number);
    b.onclick=()=>add(i);$('pads').append(b);
  }
  document.querySelectorAll('[data-voice]').forEach(b=>{ b.onclick=()=>{stop();state.role=b.dataset.voice;status('');render();};});
  $('undo').onclick=()=>{
    stop();state[state.role].pop();state.durations[state.role].pop();
    if (!state.call.length){state.reply=[];state.durations={call:[],reply:[]};state.role='call';incoming=false;}
    status('Última nota desfeita.');replaceAddress();render();
  };
  $('listen').onclick=async()=>{
    if(playing){stop();render();return;}
    const token=++playToken;playing=true;status('');render();
    try {
      window.DuetAudio.setBlend(state.angle/90);
      await window.DuetAudio.play(viewState(),{
        onStep(role,index){if(token!==playToken || !['call','reply'].includes(role))return;step={role,index};updateSlots();paint();},
        onEnd(){if(token!==playToken)return;playing=false;step=null;render();}
      });
    } catch (_) { if(token===playToken){stop();status('O som não pôde iniciar. Tente outro navegador.');render();} }
  };
  $('angle').oninput=e=>{setAngle(Number(e.target.value));replaceAddress();};
  let drag=null;
  $('art').onpointerdown=e=>{drag={x:e.clientX,start:state.angle};e.currentTarget.setPointerCapture(e.pointerId);};
  $('art').onpointermove=e=>{if(!drag)return;setAngle(drag.start+(e.clientX-drag.x)*110/e.currentTarget.clientWidth);};
  $('art').onpointerup=$('art').onpointercancel=()=>{if(drag){drag=null;replaceAddress();}};
  $('send').onclick=()=>showDialog('share'); $('help').onclick=()=>showDialog('help');
  $('reset').onclick=()=>showDialog('reset');$('close').onclick=()=>$('modal').close();
  $('confirmReset').onclick=()=>{stop();state.call=[];state.reply=[];state.durations={call:[],reply:[]};state.role='call';incoming=false;setAngle(38);replaceAddress();$('modal').close();status('Nova carta pronta.');render();};
  $('copy').onclick=async()=>{
    const field=$('link');
    try {await navigator.clipboard.writeText(field.value);$('copyStatus').textContent='Link copiado.';}
    catch(_){field.focus();field.select();$('copyStatus').textContent='O link está selecionado. Use a opção Copiar do seu dispositivo.';}
  };
  $('saveArt').onclick=async()=>{
    const img=$('art');const out=document.createElement('canvas');out.width=1200;out.height=900;
    const g=out.getContext('2d');g.fillStyle='#191b2a';g.fillRect(0,0,1200,900);
    const h=1200*img.height/img.width;g.drawImage(img,0,(820-h)/2,1200,h);
    g.fillStyle='#f7f4ed';g.font='italic 64px Instrument,Georgia';g.fillText('Entre notas',60,817);
    g.font='22px sans-serif';g.fillText(state.reply.length?'Carta em duas vozes':'Primeira voz',60,860);
    out.toBlob(blob=>{if(blob)download(blob,'entre-notas-capa.png');},'image/png');
  };
  $('export').onclick=async()=>{downloadBusy=true;render();try{
    const snapshot={call:[...state.call],reply:[...state.reply],durations:{call:[...state.durations.call],reply:[...state.durations.reply]}};
    const blob=await window.DuetAudio.wav(snapshot);download(blob,'entre-notas.wav');status('Áudio pronto para salvar.');
  } catch(_){status('Não foi possível exportar o áudio.');}finally{downloadBusy=false;render();}};
  window.addEventListener('keydown',e=>{if(e.repeat || e.ctrlKey||e.metaKey||e.altKey||$('modal').open||e.target.closest('input:not([type=range]),textarea,select'))return;
    if(/^[1-6]$/.test(e.key)){e.preventDefault();add(Number(e.key)-1);}
  });
  window.addEventListener('hashchange',()=>{stop();if(!decode()){state.call=[];state.reply=[];state.durations={call:[],reply:[]};state.role='call';incoming=false;state.angle=38;}setAngle(state.angle);render();});
  window.addEventListener('pagehide',()=>stop());
  if(location.hash&&!decode()){invalid=true;state.call=[];state.reply=[];state.durations={call:[],reply:[]};state.angle=38;}
  setAngle(state.angle);render();
  if(invalid)status('Link não reconhecido. Você pode começar uma carta nova.');
  if(window.ResizeObserver)new ResizeObserver(paint).observe($('art')); else window.addEventListener('resize',paint);
})();