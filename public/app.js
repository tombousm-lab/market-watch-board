/* Market Desk — zero-dependency static dashboard. All external market requests
   happen on GitHub Actions, not in visitors' browsers. */
(() => {
  'use strict';

  const CATALOG = [
    {id:'komatsu', short:'コマツ', name:'コマツ', symbol:'6301.T', group:'jp', unit:'JPY', mark:'K'},
    {id:'shinetsu', short:'信越化学', name:'信越化学工業', symbol:'4063.T', group:'jp', unit:'JPY', mark:'信'},
    {id:'ajinomoto', short:'味の素', name:'味の素', symbol:'2802.T', group:'jp', unit:'JPY', mark:'味'},
    {id:'berkshire', short:'バークシャー', name:'Berkshire Hathaway B', symbol:'BRK-B', group:'us', unit:'USD', mark:'BR'},
    {id:'tsmc', short:'TSMC', name:'TSMC（NYSE ADR）', symbol:'TSM', group:'us', unit:'USD', mark:'TS'},
    {id:'alphabet', short:'Google', name:'Alphabet / Google A', symbol:'GOOGL', group:'us', unit:'USD', mark:'G'},
    {id:'autodesk', short:'Autodesk', name:'Autodesk', symbol:'ADSK', group:'us', unit:'USD', mark:'A'},
    {id:'genomics', short:'10x Genomics', name:'10x Genomics', symbol:'TXG', group:'us', unit:'USD', mark:'10x'},
    {id:'sp500', short:'S&P 500', name:'S&P 500 Index', symbol:'^GSPC', group:'index', unit:'PTS', mark:'S&P'},
    {id:'allcountry', short:'オルカン', name:'eMAXIS Slim 全世界株式（オール・カントリー）', symbol:'0331418A', group:'fund', unit:'JPY_10000', mark:'全'},
    {id:'emaxis_sp500', short:'eMAXIS Slim S&P500', name:'eMAXIS Slim 米国株式（S&P500）', symbol:'03311187', group:'fund', unit:'JPY_10000', mark:'500'},
    {id:'sbi_div', short:'SBI 全世界高配当', name:'SBI 全世界高配当株式ファンド（年4回決算型）', symbol:'8931124A', group:'fund', unit:'JPY_10000', mark:'SBI'},
    {id:'gold', short:'Gold（1g）', name:'Gold / 金先物換算', symbol:'GC=F × JPY=X', group:'metal', unit:'JPY_GRAM', mark:'Au'}
  ];
  const GROUPS = {jp:'日本株', us:'米国株', index:'指数', fund:'投資信託', metal:'コモディティ'};
  const SOURCE = {
    komatsu:'https://finance.yahoo.co.jp/quote/6301.T', shinetsu:'https://finance.yahoo.co.jp/quote/4063.T', ajinomoto:'https://finance.yahoo.co.jp/quote/2802.T',
    berkshire:'https://finance.yahoo.com/quote/BRK-B', tsmc:'https://finance.yahoo.com/quote/TSM', alphabet:'https://finance.yahoo.com/quote/GOOGL',
    autodesk:'https://finance.yahoo.com/quote/ADSK', genomics:'https://finance.yahoo.com/quote/TXG',sp500:'https://finance.yahoo.com/quote/%5EGSPC',
    allcountry:'https://www.am.mufg.jp/fund/253425.html', emaxis_sp500:'https://emaxis.am.mufg.jp/fund/253266.html', sbi_div:'https://apl.wealthadvisor.jp/webasp/sbi_am/pc/basic/sa_2024100101.html',
    gold:'https://finance.yahoo.com/quote/GC%3DF/'
  };
  const $ = id => document.getElementById(id);
  const state = {
    data: null, loadError:false, assets: [], filter:'all', search:'', favorites:readFavorites(), favoritesOnly:false,
    yen:false, sort:'default', current:null, range:365, holdings:readHoldings()
  };
  function readFavorites() { try { const a = JSON.parse(localStorage.getItem('marketdesk-favorites') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } }
  const HOLDINGS_KEY='marketdesk-holdings-v2';
  function cleanHoldings(obj) {
    const out={};
    if(!obj || typeof obj!=='object' || Array.isArray(obj)) return out;
    for(const a of CATALOG) {
      if(a.group==='index') continue; // S&P500 is an index, not a purchasable instrument.
      const record=obj[a.id];
      if(!record || typeof record!=='object' || Array.isArray(record)) continue;
      const qty=Number(record.quantity);
      const cost=record.costJPY==='' || record.costJPY==null ? null : Number(record.costJPY);
      if(!Number.isFinite(qty) || qty<0 || qty>1e12) continue;
      if(qty>0) out[a.id]={quantity:qty, costJPY:Number.isFinite(cost)&&cost>=0&&cost<=1e15?cost:null};
    }
    return out;
  }
  function readHoldings(){
    try {return cleanHoldings(JSON.parse(localStorage.getItem('marketdesk-holdings-v2')||'{}'));}
    catch{return {};}
  }
  function persistHoldings(){
    try {localStorage.setItem(HOLDINGS_KEY,JSON.stringify(state.holdings));return true;}
    catch{return false;}
  }
  function quantityUnit(a){return a.group==='fund'?'口':a.group==='metal'?'g':'株';}
  function quantityLabel(a){return a.group==='fund'?'口数':a.group==='metal'?'重量（g）':'株数';}
  function getFx(){const n=state.data?.fx?.usd_jpy;return n===null || n===undefined || !Number.isFinite(Number(n)) || Number(n)<=0?null:Number(n);}
  function holdingValueJPY(a,quantity){
    if(a.group==='index' || !Number.isFinite(a.price) || quantity<=0)return null;
    const fx=a.currency==='USD'?getFx():1;
    if(fx===null)return null;
    const m = a.currency === 'JPY_10000' ? 0.0001 : 1;
    return a.price * quantity * m * fx;
  }
  function holdingOf(a){return state.holdings[a.id]||{quantity:0,costJPY:null};}
  function jpy(n){return Number.isFinite(n)?'¥'+nf(Math.round(n),0):'—';}
  function formattedQty(n){return nf(n, Number.isInteger(n)?0:Math.min(4,(String(n).split('.')[1]||'').length));}
  function portfolioModel(){
    const assets=state.assets.filter(a=>a.group!=='index' && holdingOf(a).quantity>0);
    const valued=[];const missing=[];let total=0,profit=0,withCost=0;
    const groups={};
    for(const a of assets){
      const h=holdingOf(a);const value=holdingValueJPY(a,h.quantity);
      if(value===null){missing.push(a);continue;}
      valued.push(a);total+=value;groups[a.group]=(groups[a.group]||0)+value;
      if(Number.isFinite(h.costJPY)) {profit+=value-h.costJPY;withCost++;}
    }
    return {assets,valued,missing,total,profit,withCost,groups};
  }
  function renderPortfolio(){
    const p=portfolioModel();
    $('holdingsTotal').textContent=p.valued.length?jpy(p.total):p.assets.length?'—':'¥0';
    $('holdingsCount').innerHTML=`${p.assets.length} <em>銘柄</em>`;
    $('holdingsTotalNote').textContent=p.missing.length?`価格・為替未取得の${p.missing.length}銘柄は合計から除外`:
      p.assets.length?'登録済み保有数量から自動計算':'数量を入力すると評価額を計算';
    $('holdingsPnL').textContent=p.withCost?signed(Math.round(p.profit),0)+'円':'—';
    $('holdingsPnL').className='change-'+direction(p.profit);
    $('holdingsPnlNote').textContent=p.withCost?`取得額を登録した${p.withCost}銘柄のみで算出`:'取得額の入力は任意です';
    const breakdown=$('portfolioBreakdown');
    if(!p.assets.length){breakdown.innerHTML='<span>まだ数量が設定されていません。「保有数量を登録・編集」から登録できます。</span>';return;}
    const entries=Object.entries(p.groups).sort((a,b)=>b[1]-a[1]);
    const tones={jp:'#63dfb6',us:'#83b6ff',fund:'#b3a7f0',metal:'#e1bc81'};
    const bars=entries.map(([key,value])=>`<div class="portfolio-segment" style="width:${(value/p.total*100).toFixed(3)}%;background:${tones[key]||'#b1d0d2'}" title="${safeText(GROUPS[key])}: ${jpy(value)}"></div>`).join('');
    const caption=entries.map(([key,value])=>`<span class="portfolio-legend-item"><i style="background:${tones[key]||'#b1d0d2'}"></i>${GROUPS[key]} <b>${(value/p.total*100).toFixed(1)}%</b></span>`).join('');
    breakdown.innerHTML=`<div class="breakdown-label">円換算の構成比（評価できた銘柄のみ）</div><div class="portfolio-bar">${bars||'<span class="bar-empty"></span>'}</div><div class="portfolio-legend">${caption}</div>${p.missing.length?`<p class="portfolio-warning">※ 未評価の${p.missing.length}銘柄：${p.missing.map(a=>safeText(a.short)).join('、')}</p>`:''}`;
  }
  function renderDetailHolding(){
    const a=state.assets.find(x=>x.id===state.current);
    if(!a)return;
    const el=$('dialogHolding');
    if(a.group==='index'){$('editFromDetail').hidden=true;el.textContent='S&P500は指数なので保有数量は登録できません。対応するeMAXIS Slim S&P500のほうに口数を入力してください。';return;}
    $('editFromDetail').hidden=false;
    const h=holdingOf(a);
    if(!(h.quantity>0)){el.textContent='保有数量：未登録';return;}
    const val=holdingValueJPY(a,h.quantity);
    const profit=val!==null&&Number.isFinite(h.costJPY)?` / 評価損益 ${signed(Math.round(val-h.costJPY),0)}円`:'';
    el.textContent=`保有：${formattedQty(h.quantity)} ${quantityUnit(a)} / 評価額 ${jpy(val)}${profit}`;
  }
  function renderHoldingEditor(){
    $('holdingsSaveStatus').textContent='0 または空欄は未保有として扱います。';
    $('holdingsEditorRows').innerHTML=CATALOG.filter(a=>a.group!=='index').map(a=>{
      const h=holdingOf(a);const precision=a.group==='metal'?'0.01':'1';
      return `<div class="holding-row" data-holding="${a.id}">
        <div class="holding-editor-title"><strong>${safeText(a.short)}</strong><small>${safeText(a.symbol)} · ${GROUPS[a.group]}</small></div>
        <label><span class="mobile-edit-label">${quantityLabel(a)} (${quantityUnit(a)})</span><div class="number-unit"><input class="holding-quantity" type="number" inputmode="decimal" min="0" max="1000000000000" step="${precision}" aria-label="${safeText(a.short)}の${quantityLabel(a)}" value="${h.quantity||''}" placeholder="0"><span>${quantityUnit(a)}</span></div></label>
        <label><span class="mobile-edit-label">取得額合計（円）</span><div class="number-unit"><input class="holding-cost" type="number" inputmode="decimal" min="0" max="1000000000000000" step="1" aria-label="${safeText(a.short)}の取得額合計（円）" value="${Number.isFinite(h.costJPY)?h.costJPY:''}" placeholder="任意"><span>円</span></div></label>
      </div>`;
    }).join('');
  }
  function openHoldingsEditor(focusId=null){
    renderHoldingEditor();
    const dialog=$('holdingsDialog');if(!dialog.open)dialog.showModal();
    if(focusId){const row=[...dialog.querySelectorAll('[data-holding]')].find(x=>x.dataset.holding===focusId);if(row){row.scrollIntoView({block:'nearest'});row.querySelector('.holding-quantity')?.focus();}}
  }
  function saveHoldingsEditor(){
    const obj={};let invalid=null;
    document.querySelectorAll('.holding-row').forEach(row=>{
      const qtyRaw=row.querySelector('.holding-quantity').value.trim();
      const costRaw=row.querySelector('.holding-cost').value.trim();
      const quantity=qtyRaw===''?0:Number(qtyRaw);
      const costJPY=costRaw===''?null:Number(costRaw);
      if(!Number.isFinite(quantity)||quantity<0||quantity>1e12|| (costJPY!==null&&(!Number.isFinite(costJPY)||costJPY<0||costJPY>1e15))){invalid=row;return;}
      if(quantity>0)obj[row.dataset.holding]={quantity,costJPY};
    });
    if(invalid){$('holdingsSaveStatus').textContent='数値を確認してください。数量・取得額は0以上で入力してください。';invalid.querySelector('input:invalid, input')?.focus();return;}
    state.holdings=cleanHoldings(obj);
    const ok=persistHoldings();
    renderPortfolio();renderList();renderDetailHolding();
    if(ok){$('holdingsDialog').close();}
    else{$('holdingsSaveStatus').textContent='ブラウザの保存領域に書き込めません。設定を保存（JSON）でバックアップしてください。';}
  }
  function exportHoldings(){
    const payload=JSON.stringify({format:'marketdesk-holdings',version:2,exported_at:new Date().toISOString(),holdings:state.holdings},null,2);
    const blob=new Blob([payload],{type:'application/json'});const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='marketdesk-holdings.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  async function importHoldings(file){
    if(!file)return;
    try{
      if(file.size>256000)throw new Error('ファイルが大きすぎます。');
      const x=JSON.parse(await file.text());
      if(x?.format!=='marketdesk-holdings'||x?.version!==2||!x?.holdings||typeof x.holdings!=='object'||Array.isArray(x.holdings))throw new Error('Market Deskの設定JSONを選んでください。');
      state.holdings=cleanHoldings(x.holdings);
      if(!persistHoldings())throw new Error('保存領域に書き込めませんでした。');
      renderPortfolio();renderList();renderDetailHolding();
      alert(`保有数量を${Object.keys(state.holdings).length}銘柄分読み込みました。`);
    }catch(err){alert('読み込みできませんでした: '+err.message);}
  }

  function safeText(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[c])); }
  function nf(n,d=0) { if (!Number.isFinite(n)) return '—'; return new Intl.NumberFormat('ja-JP',{minimumFractionDigits:d, maximumFractionDigits:d}).format(n); }
  function unit(code) { return ({JPY:'円', USD:'USD', PTS:'pt', JPY_10000:'円 / 1万口', JPY_GRAM:'円 / 1g'})[code] || code; }
  function digits(code) { return code==='USD'?2:code==='JPY_GRAM'?2:code==='PTS'?2:0; }
  function displayPrice(num,currency) { return Number.isFinite(num) ? nf(num,digits(currency)) : '—'; }
  function direction(v) { return !Number.isFinite(v) ? 'flat' : v>0 ? 'up' : v<0 ? 'down':'flat'; }
  function signed(v,d=2) { return Number.isFinite(v) ? (v>0?'+':v<0?'−':'±') + nf(Math.abs(v),d) : '—'; }
  function dateLabel(iso) { if (!iso) return '—'; const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[2])}/${Number(m[3])}` : iso; }
  function dateFull(iso) { if (!iso) return '—'; return iso.replace(/-/g,'/'); }
  function generatedTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  }
  function nonemptyHistory(a) { return (Array.isArray(a.history)?a.history:[]).filter(p=>p && Number.isFinite(Number(p.value)) && Number(p.value)>0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date)).sort((a,b)=>a.date.localeCompare(b.date)); }
  function historyRange(history,days) {
    if (!history.length) return [];
    const last = Date.parse(history[history.length-1].date+'T00:00:00Z');
    return history.filter(p=>Date.parse(p.date+'T00:00:00Z')>=last-(days*86400000));
  }
  function svgPoints(points,width,height,pad=6) {
    const values = points.map(x=>Number(x.value)).filter(Number.isFinite);
    if (values.length<2) return null;
    let min = Math.min(...values), max=Math.max(...values);
    let margin = Math.max((max-min)*.16, Math.abs(max)*.0008);
    min-=margin;max+=margin;
    return values.map((v,i)=>({x:pad+(width-2*pad)*i/(values.length-1),y:pad+(height-2*pad)*(1-(v-min)/(max-min)),v}));
  }
  function pathLine(data) {return data.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');}
  function sparkline(asset) {
    const points = svgPoints(historyRange(nonemptyHistory(asset),30),110,38,3);
    if (!points) return '<svg viewBox="0 0 110 38" aria-hidden="true"><path d="M2 20 H108" fill="none" stroke="#46626a" stroke-dasharray="3 5"/></svg>';
    const kind = direction(asset.change_pct);
    const color = kind==='up'?'#64dcaf':kind==='down'?'#ff8192':'#96b7be';
    const last=points[points.length-1];
    return `<svg viewBox="0 0 110 38" aria-hidden="true"><path d="${pathLine(points)}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.8" fill="${color}"/></svg>`;
  }
  function yenSubline(a) {
    const fx = Number(state.data?.fx?.usd_jpy);
    if (state.yen && a.currency==='USD' && Number.isFinite(a.price) && Number.isFinite(fx) && fx>0) {
      return `円換算 参考 ¥${nf(a.price*fx,0)}`;
    }
    if (a.currency==='JPY_10000') return '基準価額・1万口あたり';
    if (a.currency==='JPY_GRAM') return '円換算・税込店頭価格ではない';
    return a.currency==='USD'?'1株 / 米ドル':a.currency==='PTS'?'指数ポイント':'1株 / 日本円';
  }
  function combineAssets(data) {
    const lookup = new Map((data?.assets||[]).filter(Boolean).map(x=>[x.id,x]));
    return CATALOG.map(meta=>{
      const val=lookup.get(meta.id)||{};
      const rawPrice = val.price===null || val.price===undefined ? null : Number(val.price);
      const rawChange = val.change===null || val.change===undefined ? null : Number(val.change);
      const rawChangePct = val.change_pct===null || val.change_pct===undefined ? null : Number(val.change_pct);
      return {...meta, currency: val.currency || meta.unit, price: Number.isFinite(rawPrice)?rawPrice:null, change:Number.isFinite(rawChange)?rawChange:null,
        change_pct:Number.isFinite(rawChangePct)?rawChangePct:null,
        status:val.status||'unavailable', as_of:val.as_of||null, history:val.history||[],
        source_url:val.source_url||SOURCE[meta.id]};
    });
  }
  function renderMetrics() {
    $('totalMetric').textContent=state.assets.length;
    const quoted=state.assets.filter(x=>Number.isFinite(x.price));
    $('upMetric').textContent=quoted.length?state.assets.filter(x=>Number.isFinite(x.change_pct)&&x.change_pct>0).length:'—';
    $('downMetric').textContent=quoted.length?state.assets.filter(x=>Number.isFinite(x.change_pct)&&x.change_pct<0).length:'—';
    const fx=Number(state.data?.fx?.usd_jpy);
    const fxOK=state.data?.fx?.usd_jpy!=null && Number.isFinite(fx) && fx>0;
    $('fxMetric').textContent=fxOK?nf(fx,2):'—';
    $('fxDate').textContent=fxOK?`${dateFull(state.data.fx.as_of)} 時点${state.data.fx.status==='cached'?'・保存値':''}`:'為替データの取得待ち';
    const updated=generatedTime(state.data?.generated_at);
    const fresh=state.assets.filter(x=>x.status==='ok').length;
    const cached=state.assets.filter(x=>x.status==='cached').length;
    const missing=state.assets.filter(x=>x.status==='unavailable').length;
    const status=$('updateStatus');
    if(state.loadError) {status.textContent='データ読み込みに失敗しました。接続状況とPages公開設定を確認してください。';}
    else if(!updated) {status.textContent='初回更新待ち — GitHub Actionsを実行してください';}
    else {status.textContent=`${updated} JST 取得${fresh}件${cached?` · 保存値${cached}件`:''}${missing?` · 未取得${missing}件`:''}`;}
    $('statusDot').classList.toggle('warn',!fresh || !!cached || !!missing);
  }
  function renderList() {
    const q=state.search.trim().normalize('NFKC').toLowerCase();
    let visible=state.assets.filter(a=>(state.filter==='all'||a.group===state.filter)&&(!state.favoritesOnly||state.favorites.has(a.id))&&(!q||[a.short,a.name,a.symbol].some(s=>s.normalize('NFKC').toLowerCase().includes(q))));
    if(state.sort==='change_desc'||state.sort==='change_asc') visible.sort((a,b)=>{
      const x=Number.isFinite(a.change_pct)?a.change_pct:null, y=Number.isFinite(b.change_pct)?b.change_pct:null;
      if(x===null) return 1; if(y===null) return -1;
      return state.sort==='change_desc'?y-x:x-y;
    });
    if(state.sort==='name') visible.sort((a,b)=>a.short.localeCompare(b.short,'ja'));
    $('visibleCount').textContent=visible.length;
    $('emptyState').hidden=!!visible.length;
    $('assetList').innerHTML=visible.map(a=>{
      const d=direction(a.change_pct), digitsCount=digits(a.currency), unknown=!Number.isFinite(a.price);
      const changeValue=unknown?'—':signed(a.change,digitsCount);
      const percent=unknown?'未取得':signed(a.change_pct,2)+'%';
      const lastStatus=a.status==='cached'?'取得失敗・保存値':a.status==='unavailable'?'データ未取得':'前営業日終値等';
      const fav=state.favorites.has(a.id);
      const h=holdingOf(a);const hasQty=h.quantity>0;
      const owned=hasQty?`<span class="held-badge">保有 ${formattedQty(h.quantity)} ${quantityUnit(a)} · ${jpy(holdingValueJPY(a,h.quantity))}</span>`:'';
      return `<article class="asset-row" tabindex="0" role="button" data-id="${a.id}" data-group="${a.group}" aria-label="${safeText(a.name)}の価格履歴を見る">
         <div class="asset-name"><span class="asset-mark">${safeText(a.mark)}</span><button class="star${fav?' saved':''}" type="button" aria-pressed="${fav}" aria-label="${safeText(a.short)}をお気に入り${fav?'から削除':'に登録'}" data-fav="${a.id}">${fav?'★':'☆'}</button><div class="name-lines"><span class="asset-title">${safeText(a.short)}</span><span class="asset-code">${safeText(a.symbol)} <i class="group-dot"></i> ${GROUPS[a.group]}</span>${owned}</div></div>
         <div class="asset-price"><strong>${displayPrice(a.price,a.currency)}</strong><small>${safeText(yenSubline(a))}</small></div>
         <div class="asset-change"><strong class="change-${d}">${changeValue}</strong><span>${percent}</span></div>
         <div class="asset-trend">${sparkline(a)}</div>
         <div class="asset-date"><span>${dateLabel(a.as_of)}</span><small class="${a.status==='cached'?'cached-label':''}">${lastStatus}</small></div>
         <div class="asset-open" aria-hidden="true">›</div>
       </article>`;
    }).join('');
  }
  function makeLargeChart(asset,days) {
    const data=historyRange(nonemptyHistory(asset),days);
    if(data.length<2) return '<div class="chart-placeholder">価格履歴がまだ十分にありません。<br>データ取得後、チャートが表示されます。</div>';
    const w=720,h=270,pL=20,pR=72,pT=30,pB=29;
    const values=data.map(x=>Number(x.value)),min0=Math.min(...values),max0=Math.max(...values);
    const spread=Math.max((max0-min0)*1.3,Math.max(max0,1)*.004);
    const min=Math.max(0,min0-(spread-(max0-min0))/2),max=max0+(spread-(max0-min0))/2;
    const denom=max-min||1;
    const pts=data.map((p,i)=>({x:pL+(w-pL-pR)*i/(data.length-1),y:pT+(h-pT-pB)*(1-(Number(p.value)-min)/denom),value:Number(p.value),date:p.date}));
    const trend=direction(data[data.length-1].value-data[0].value);
    const color=trend==='up'?'#63dfb6':trend==='down'?'#ff8494':'#b5c9ca';
    const line=pathLine(pts);
    const fill=line+` L${pts[pts.length-1].x.toFixed(2)} ${h-pB} L${pL} ${h-pB} Z`;
    const labels=Array.from({length:4},(_,i)=>{
      const frac=i/3,yy=pT+(h-pT-pB)*frac,num=max-frac*(max-min);
      return `<line x1="${pL}" x2="${w-pR}" y1="${yy}" y2="${yy}" stroke="#36505b" stroke-dasharray="3 5" stroke-opacity=".78"/><text x="${w-9}" y="${yy+4}" text-anchor="end" fill="#799ba6" font-size="11">${nf(num,digits(asset.currency))}</text>`;
    }).join('');
    const monthLabels=[0,Math.floor((pts.length-1)/2),pts.length-1].map(i=>`<text x="${pts[i].x}" y="${h-9}" fill="#799ba6" text-anchor="${i===0?'start':i===pts.length-1?'end':'middle'}" font-size="11">${dateLabel(pts[i].date)}</text>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${safeText(asset.name)}の価格履歴、${dateFull(data[0].date)}から${dateFull(data[data.length-1].date)}まで">
      <defs><linearGradient id="chartfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".23"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${labels}<path d="${fill}" fill="url(#chartfill)"/><path d="${line}" fill="none" stroke="${color}" stroke-linejoin="round" stroke-width="2.8" stroke-linecap="round"/>
      <circle cx="${pts[pts.length-1].x}" cy="${pts[pts.length-1].y}" r="4" fill="${color}" stroke="#10252e" stroke-width="2"/>${monthLabels}
    </svg>`;
  }
  function openDetail(id) {
    const a=state.assets.find(x=>x.id===id);
    if(!a)return;
    state.current=id;state.range=365;
    $('dialogGroup').textContent=GROUPS[a.group];
    $('dialogName').textContent=a.name;
    $('dialogTicker').textContent=a.symbol;
    $('dialogPrice').innerHTML=`${displayPrice(a.price,a.currency)}<small>${safeText(unit(a.currency))}</small>`;
    $('dialogChange').className='dialog-change change-'+direction(a.change_pct);
    $('dialogChange').textContent=`${signed(a.change,digits(a.currency))} (${signed(a.change_pct,2)}%)`;
    const link=$('dialogSource');link.href=a.source_url||SOURCE[id];
    $('dialogAsOf').textContent='基準日 '+dateFull(a.as_of);
    $('dialogNote').textContent=a.status==='cached'?'今回の更新では価格が取得できなかったため、前回保存したデータを表示しています。':a.status==='unavailable'?'価格が未取得です。GitHub Actionsの実行結果を確認してください。':a.currency==='JPY_GRAM'?'金先物（USD/トロイオンス）× USD/JPY ÷ 31.1034768で計算した参考値です。国内地金の店頭販売・買取価格ではありません。':a.currency==='JPY_10000'?'基準価額（1万口あたり）です。分配金再投資を含まないため、分配日前後の値動きとトータルリターンは異なります。':'取引所の営業日に基づく日次価格です。表示時点のリアルタイム株価ではありません。';
    document.querySelectorAll('.range-group button').forEach(b=>b.classList.toggle('chosen',Number(b.dataset.range)===365));
    updateDetailChart();
    renderDetailHolding();
    const dialog=$('detailDialog');
    if(!dialog.open)dialog.showModal();
  }
  function updateDetailChart() {
    const a=state.assets.find(x=>x.id===state.current);
    if(!a)return;
    const hist=historyRange(nonemptyHistory(a),state.range);
    $('largeChart').innerHTML=makeLargeChart(a,state.range);
    $('chartRangeText').textContent=hist.length>=1?`${dateFull(hist[0].date)}  —  ${dateFull(hist[hist.length-1].date)}`:'履歴なし';
  }
  function refreshClock() {
    $('jstClock').textContent=new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' JST';
  }
  async function load() {
    const btn=$('reloadBtn');btn.classList.add('is-spinning');
    try {
      const response=await fetch('./data/market.json?ts='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      state.data=await response.json();
      state.loadError=false;
      state.assets=combineAssets(state.data);
    } catch(err) {
      console.error('market data could not be loaded',err);
      state.data=null;state.loadError=true;state.assets=combineAssets(null);
      $('updateStatus').textContent='データの読み込みに失敗しました。通信と公開設定をご確認ください。';
    }
    renderMetrics();renderPortfolio();renderList();btn.classList.remove('is-spinning');
  }
  function bind() {
    $('reloadBtn').addEventListener('click',load);
    $('editHoldingsBtn').addEventListener('click',()=>openHoldingsEditor());
    $('exportHoldingsBtn').addEventListener('click',exportHoldings);
    $('importHoldingsFile').addEventListener('change',async e=>{await importHoldings(e.target.files?.[0]);e.target.value='';});
    $('closeHoldingsDialog').addEventListener('click',()=>$('holdingsDialog').close());
    $('cancelHoldingsBtn').addEventListener('click',()=>$('holdingsDialog').close());
    $('saveHoldingsBtn').addEventListener('click',saveHoldingsEditor);
    $('holdingsDialog').addEventListener('click',e=>{if(e.target===$('holdingsDialog'))$('holdingsDialog').close();});
    $('editFromDetail').addEventListener('click',()=>{const id=state.current;$('detailDialog').close();openHoldingsEditor(id);});
    $('searchInput').addEventListener('input',e=>{state.search=e.target.value;renderList();});
    $('filters').addEventListener('click',e=>{
      const btn=e.target.closest('button[data-group]');if(!btn)return;
      state.filter=btn.dataset.group;
      document.querySelectorAll('.filter').forEach(b=>{const active=b===btn;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
      renderList();
    });
    $('favoriteFilter').addEventListener('click',()=>{
      state.favoritesOnly=!state.favoritesOnly;
      $('favoriteFilter').classList.toggle('selected',state.favoritesOnly);
      $('favoriteFilter').setAttribute('aria-pressed',String(state.favoritesOnly));
      renderList();
    });
    $('yenToggle').addEventListener('change',e=>{state.yen=e.target.checked;renderList();});
    $('sortSelect').addEventListener('change',e=>{state.sort=e.target.value;renderList();});
    $('assetList').addEventListener('click',e=>{
      const fav=e.target.closest('button[data-fav]');
      if(fav){const id=fav.dataset.fav;state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id);
        try{localStorage.setItem('marketdesk-favorites',JSON.stringify([...state.favorites]));}catch{}renderList();return;}
      const card=e.target.closest('[data-id]');if(card)openDetail(card.dataset.id);
    });
    $('assetList').addEventListener('keydown',e=>{
      if((e.key==='Enter'||e.key===' ') && e.target.classList.contains('asset-row')){
        e.preventDefault();openDetail(e.target.dataset.id);
      }
    });
    $('closeDialog').addEventListener('click',()=>$('detailDialog').close());
    $('detailDialog').addEventListener('click',e=>{if(e.target===$('detailDialog'))$('detailDialog').close();});
    document.querySelector('.range-group').addEventListener('click',e=>{
      const b=e.target.closest('[data-range]');if(!b)return;
      state.range=Number(b.dataset.range);
      document.querySelectorAll('.range-group button').forEach(x=>x.classList.toggle('chosen',x===b));
      updateDetailChart();
    });
  }
  bind();refreshClock();setInterval(refreshClock,30000);load();
})();
